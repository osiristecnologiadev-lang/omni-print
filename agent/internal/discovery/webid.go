package discovery

import (
	"context"
	"crypto/tls"
	"fmt"
	"html"
	"io"
	"log"
	"net"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/omniprint/agent/internal/config"
)

// Printers with SNMP switched off never show up in a sweep (it only speaks
// SNMP), and only appear at all when a print queue happens to name their
// address. Found for real at DAC (2026-11): two color HPs the outsourcing
// company bills every month, invisible to a daily sweep of every network
// the agent reaches. Every network printer still listens on raw printing
// (tcp/9100) and serves its web page, so for the addresses CLOSE to the
// agent that never answered SNMP, the sweep checks tcp/9100 and reads the
// model (and serial, when the page shows it) from that page.
//
// Deliberately bounded, unlike the SNMP sweep: one port, only on the
// agent's own subnet(s), the /24s next to known printers and other small
// scanned ranges - never a panel-configured /16 (that would be a real port
// scan of a whole corporate network, and hours of extra sweep).
// jetdirectPort is a var only so tests can point it at a local listener.
var jetdirectPort = 9100

const (
	jetdirectDialTimeout  = 800 * time.Millisecond
	jetdirectConcurrency  = 64
	maxJetdirectAddresses = 8192
	jetdirectSmallNet     = 1024 // other scanned ranges up to this many hosts are in scope
	webFetchTimeout       = 5 * time.Second
	webMaxBody            = 256 << 10
)

// webIdentity is what a printer's own web page says about it.
type webIdentity struct {
	Model  string
	Serial string
	Label  bool // a label/receipt printer (Zebra etc.) - not billed per page
}

// officeVendors / labelVendors are matched (case-insensitively) against the
// page's title, body and Server header to tell a printer's page apart from
// any other web server that happens to listen on 9100.
// Whole words only - "oki" must not match "cookie".
var (
	officeVendorRe = regexp.MustCompile(`(?i)\b(laserjet|officejet|deskjet|pagewide|hewlett|hp|samsung|brother|epson|kyocera|ricoh|lexmark|xerox|canon|oki|okidata|sharp|konica|bizhub|pantum|toshiba|e-studio)\b`)
	labelVendorRe  = regexp.MustCompile(`(?i)\b(zebra|elgin|bematech|argox|datamax|honeywell|tsc|godex)\b`)
)

var (
	titleRe = regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)
	tagRe   = regexp.MustCompile(`(?s)<[^>]*>`)
	spaceRe = regexp.MustCompile(`\s+`)
	// "Serial Number: BRBST4S07W", "Número de série</td><td>BRBST4S07W" ...
	serialRe = regexp.MustCompile(`(?i)(?:serial(?:\s*(?:number|no\.?|#))?|n[úu]mero\s+de\s+s[ée]rie)\s*[:#]?\s*([A-Z0-9]{8,15})\b`)
	// Model names as printers spell them in their own page.
	modelRe = regexp.MustCompile(`(?i)\b((?:HP\s+)?(?:Color\s+)?(?:LaserJet|OfficeJet|PageWide|DeskJet)[A-Za-z0-9 \-]{0,40}|Samsung\s+[A-Z]{1,3}[\- ]?[A-Z]?\d{3,4}[A-Za-z]*(?:\s+Series)?|Brother\s+[A-Z]{2,4}-[A-Z0-9]{3,8}|Epson\s+[A-Z]{1,3}-?\d{3,5}[A-Za-z]*|Kyocera\s+[A-Za-z\- ]{0,20}\d{3,5}[A-Za-z]*)`)
)

// parseWebIdentity extracts what it can from one printer web page. ok is
// false when nothing on the page looks like a printer.
func parseWebIdentity(title, body, server string) (webIdentity, bool) {
	title = cleanText(title)
	text := cleanText(tagRe.ReplaceAllString(body, " "))
	all := title + " " + text + " " + server

	var id webIdentity
	switch {
	case labelVendorRe.MatchString(all):
		id.Label = true
	case officeVendorRe.MatchString(all):
	default:
		return webIdentity{}, false
	}

	// The title is the most reliable place for the model; the body second.
	if m := modelRe.FindString(title); m != "" {
		id.Model = strings.TrimSpace(m)
	} else if m := modelRe.FindString(text); m != "" {
		id.Model = strings.TrimSpace(m)
	} else if title != "" && len(title) <= 80 {
		id.Model = title
	}
	if m := serialRe.FindStringSubmatch(text); m != nil && looksLikeSerial(m[1]) {
		id.Serial = strings.ToUpper(m[1])
	}
	return id, true
}

// looksLikeSerial keeps a regex hit only when it mixes letters and digits,
// like every real printer serial (BRBST4S07W, 088WB07K813RWWN) - a word
// that happens to follow "serial" on the page must not become a device's
// identity, since the API merges devices by serial.
func looksLikeSerial(s string) bool {
	var letters, digits bool
	for _, r := range s {
		switch {
		case r >= '0' && r <= '9':
			digits = true
		case (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z'):
			letters = true
		}
	}
	return letters && digits
}

func cleanText(s string) string {
	return strings.TrimSpace(spaceRe.ReplaceAllString(html.UnescapeString(s), " "))
}


// webClient talks to printers' embedded web servers: self-signed
// certificates everywhere, so verification is off - only ever used to READ
// the page that names the model, nothing is sent.
var webClient = &http.Client{
	Timeout: webFetchTimeout,
	Transport: &http.Transport{
		TLSClientConfig:       &tls.Config{InsecureSkipVerify: true}, //nolint:gosec // printer self-signed certs
		DisableKeepAlives:     true,
		ResponseHeaderTimeout: webFetchTimeout,
	},
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 4 {
			return http.ErrUseLastResponse
		}
		return nil
	},
}

// webPorts is a var only so tests can point it at a local fake page.
var webPorts = []struct {
	scheme string
	port   int
}{{"http", 80}, {"https", 443}}

// identifyWeb reads the printer's web page (http, then https).
func identifyWeb(ctx context.Context, ip net.IP) (webIdentity, bool) {
	for _, p := range webPorts {
		url := fmt.Sprintf("%s://%s/", p.scheme, net.JoinHostPort(ip.String(), fmt.Sprint(p.port)))
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			continue
		}
		resp, err := webClient.Do(req)
		if err != nil {
			continue
		}
		body, _ := io.ReadAll(io.LimitReader(resp.Body, webMaxBody))
		resp.Body.Close()
		title := ""
		if m := titleRe.FindSubmatch(body); m != nil {
			title = string(m[1])
		}
		if id, ok := parseWebIdentity(title, string(body), resp.Header.Get("Server")); ok {
			return id, true
		}
	}
	return webIdentity{}, false
}

// jetdirectScope picks which of the sweep's networks get the tcp/9100
// check - see this file's top comment.
func jetdirectScope(own, neighbours, others []*net.IPNet) []*net.IPNet {
	scope := append(append([]*net.IPNet{}, own...), neighbours...)
	for _, n := range others {
		ones, bits := n.Mask.Size()
		if bits-ones <= 10 && 1<<uint(bits-ones) <= jetdirectSmallNet {
			scope = append(scope, n)
		}
	}
	return scope
}

// jetdirectCandidates filters the sweep's silent addresses down to the ones
// in scope, minus anything already known, capped.
func jetdirectCandidates(silent []net.IP, scope []*net.IPNet, known map[string]bool) []net.IP {
	var out []net.IP
	seen := map[string]bool{}
	for _, ip := range silent {
		s := ip.String()
		if known[s] || seen[s] {
			continue
		}
		for _, n := range scope {
			if n.Contains(ip) {
				out = append(out, ip)
				seen[s] = true
				break
			}
		}
		if len(out) >= maxJetdirectAddresses {
			log.Printf("discovery: tcp/%d check capped at %d addresses", jetdirectPort, maxJetdirectAddresses)
			break
		}
	}
	return out
}

// jetdirectPrinters dials tcp/9100 on each candidate and identifies the
// ones that accept by their web page. Office printers come back as NoSNMP
// devices named after their model; label printers and unidentified pages
// are only logged.
func jetdirectPrinters(ctx context.Context, candidates []net.IP, community string) []config.Device {
	if len(candidates) == 0 {
		return nil
	}
	start := time.Now()
	type result struct {
		ip  net.IP
		id  webIdentity
		web bool
	}
	jobs := make(chan net.IP)
	results := make(chan result)
	var wg sync.WaitGroup
	for w := 0; w < jetdirectConcurrency; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			d := net.Dialer{Timeout: jetdirectDialTimeout}
			for ip := range jobs {
				conn, err := d.DialContext(ctx, "tcp", net.JoinHostPort(ip.String(), fmt.Sprint(jetdirectPort)))
				if err != nil {
					continue
				}
				conn.Close()
				id, ok := identifyWeb(ctx, ip)
				results <- result{ip: ip, id: id, web: ok}
			}
		}()
	}
	go func() {
		defer close(jobs)
		for _, ip := range candidates {
			select {
			case jobs <- ip:
			case <-ctx.Done():
				return
			}
		}
	}()
	go func() {
		wg.Wait()
		close(results)
	}()

	var devices []config.Device
	open := 0
	for r := range results {
		open++
		switch {
		case !r.web:
			log.Printf("discovery: %s accepts tcp/%d but its web page doesn't say it's a printer - not added", r.ip, jetdirectPort)
		case r.id.Label:
			log.Printf("discovery: %s is a label printer without SNMP (%q) - not added", r.ip, r.id.Model)
		default:
			log.Printf("discovery: %s is a printer without SNMP: %q serial %q (from its web page) - adding it", r.ip, r.id.Model, r.id.Serial)
			devices = append(devices, config.Device{
				Name:      r.id.Model,
				Host:      r.ip.String(),
				Community: community,
				Port:      161,
				NoSNMP:    true,
				WebModel:  r.id.Model,
				WebSerial: r.id.Serial,
			})
		}
	}
	log.Printf("discovery: tcp/%d check of %d silent address(es) took %s - %d accept it, %d office printer(s) without SNMP",
		jetdirectPort, len(candidates), time.Since(start).Round(time.Second), open, len(devices))
	return devices
}
