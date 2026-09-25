//go:build windows

package discovery

import (
	"fmt"
	"runtime"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Windows' own LDAP client (wldap32) rather than a Go LDAP library: binding
// with LDAP_AUTH_NEGOTIATE as LocalSystem authenticates as this machine's
// domain account with no credentials to configure, and wldap32 negotiates
// LDAP signing by itself - domain controllers increasingly require it, and
// Go libraries' SSPI binds don't implement it.
var (
	wldap32            = windows.NewLazySystemDLL("wldap32.dll")
	procLdapInit       = wldap32.NewProc("ldap_initW")
	procLdapSetOption  = wldap32.NewProc("ldap_set_optionW")
	procLdapBind       = wldap32.NewProc("ldap_bind_sW")
	procLdapSearch     = wldap32.NewProc("ldap_search_sW")
	procLdapFirstEntry = wldap32.NewProc("ldap_first_entry")
	procLdapNextEntry  = wldap32.NewProc("ldap_next_entry")
	procLdapGetValues  = wldap32.NewProc("ldap_get_valuesW")
	procLdapCountVals  = wldap32.NewProc("ldap_count_valuesW")
	procLdapValueFree  = wldap32.NewProc("ldap_value_freeW")
	procLdapMsgFree    = wldap32.NewProc("ldap_msgfree")
	procLdapUnbind     = wldap32.NewProc("ldap_unbind")
	procLdapErrString  = wldap32.NewProc("ldap_err2stringW")
)

const (
	ldapPort              = 389
	ldapOptProtocolVer    = 0x11
	ldapAuthNegotiate     = 0x0486
	ldapScopeBase         = 0
	ldapScopeSubtree      = 2
	ldapSuccess           = 0
	ldapSizeLimitExceeded = 4
	ldapReferral          = 0x0a
)

func adPrintQueues() ([]adQueue, error) {
	domain, err := machineDomain()
	if err != nil {
		return nil, err
	}

	host, _ := windows.UTF16PtrFromString(domain)
	ld, _, _ := procLdapInit.Call(uintptr(unsafe.Pointer(host)), ldapPort)
	if ld == 0 {
		return nil, fmt.Errorf("can't open an LDAP connection to domain %s", domain)
	}
	defer procLdapUnbind.Call(ld)

	version := uint32(3)
	procLdapSetOption.Call(ld, ldapOptProtocolVer, uintptr(unsafe.Pointer(&version)))
	runtime.KeepAlive(&version)

	if rc, _, _ := procLdapBind.Call(ld, 0, 0, ldapAuthNegotiate); rc != ldapSuccess {
		return nil, fmt.Errorf("can't authenticate to domain %s as this machine: %s", domain, ldapErr(rc))
	}

	rootDSE, err := ldapSearch(ld, "", ldapScopeBase, "(objectClass=*)", []string{"defaultNamingContext"})
	if err != nil {
		return nil, fmt.Errorf("read rootDSE of %s: %w", domain, err)
	}
	var base string
	if len(rootDSE) > 0 && len(rootDSE[0]["defaultNamingContext"]) > 0 {
		base = rootDSE[0]["defaultNamingContext"][0]
	}
	if base == "" {
		return nil, fmt.Errorf("domain %s didn't report its naming context", domain)
	}

	entries, err := ldapSearch(ld, base, ldapScopeSubtree, "(objectCategory=printQueue)", []string{"printerName", "serverName", "portName"})
	if err != nil {
		return nil, fmt.Errorf("search printers in %s: %w", base, err)
	}
	out := make([]adQueue, 0, len(entries))
	for _, e := range entries {
		q := adQueue{Ports: e["portName"]}
		if v := e["printerName"]; len(v) > 0 {
			q.Printer = v[0]
		}
		if v := e["serverName"]; len(v) > 0 {
			q.Server = v[0]
		}
		out = append(out, q)
	}
	return out, nil
}

// machineDomain is this machine's AD domain DNS name, or errNotInDomain.
func machineDomain() (string, error) {
	var n uint32 = 256
	buf := make([]uint16, n)
	if err := windows.GetComputerNameEx(windows.ComputerNameDnsDomain, &buf[0], &n); err != nil {
		return "", fmt.Errorf("read this machine's domain: %w", err)
	}
	domain := windows.UTF16ToString(buf[:n])
	if domain == "" {
		return "", errNotInDomain
	}
	return domain, nil
}

// ldapSearch runs one synchronous search and returns each entry's
// requested attributes. A size-limit hit (more results than the DC hands
// out in one go, 1000 by default) still returns what came back.
func ldapSearch(ld uintptr, base string, scope uint32, filter string, attrs []string) ([]map[string][]string, error) {
	basePtr, _ := windows.UTF16PtrFromString(base)
	filterPtr, _ := windows.UTF16PtrFromString(filter)
	attrPtrs := make([]*uint16, 0, len(attrs)+1)
	for _, a := range attrs {
		p, _ := windows.UTF16PtrFromString(a)
		attrPtrs = append(attrPtrs, p)
	}
	attrPtrs = append(attrPtrs, nil)

	var res uintptr
	rc, _, _ := procLdapSearch.Call(ld,
		uintptr(unsafe.Pointer(basePtr)), uintptr(scope), uintptr(unsafe.Pointer(filterPtr)),
		uintptr(unsafe.Pointer(&attrPtrs[0])), 0, uintptr(unsafe.Pointer(&res)))
	runtime.KeepAlive(basePtr)
	runtime.KeepAlive(filterPtr)
	runtime.KeepAlive(attrPtrs)
	if res != 0 {
		defer procLdapMsgFree.Call(res)
	}
	if rc != ldapSuccess && rc != ldapSizeLimitExceeded && rc != ldapReferral {
		return nil, fmt.Errorf("%s", ldapErr(rc))
	}
	if res == 0 {
		return nil, nil
	}

	var out []map[string][]string
	for entry, _, _ := procLdapFirstEntry.Call(ld, res); entry != 0; entry, _, _ = procLdapNextEntry.Call(ld, entry) {
		values := make(map[string][]string, len(attrs))
		for i, a := range attrs {
			values[a] = ldapValues(ld, entry, attrPtrs[i])
		}
		out = append(out, values)
	}
	runtime.KeepAlive(attrPtrs)
	return out, nil
}

func ldapValues(ld, entry uintptr, attr *uint16) []string {
	vals, _, _ := procLdapGetValues.Call(ld, entry, uintptr(unsafe.Pointer(attr)))
	if vals == 0 {
		return nil
	}
	defer procLdapValueFree.Call(vals)
	n, _, _ := procLdapCountVals.Call(vals)
	out := make([]string, 0, n)
	arr := unsafe.Slice((**uint16)(uintptrToPointer(vals)), n)
	for _, p := range arr {
		out = append(out, windows.UTF16PtrToString(p))
	}
	return out
}

func ldapErr(rc uintptr) string {
	msg, _, _ := procLdapErrString.Call(rc)
	if msg == 0 {
		return fmt.Sprintf("LDAP error 0x%x", rc)
	}
	return fmt.Sprintf("%s (LDAP 0x%x)", windows.UTF16PtrToString((*uint16)(uintptrToPointer(msg))), rc)
}

// uintptrToPointer converts memory wldap32 allocated (never Go-managed, so
// the GC can't move it) back into a pointer, without go vet's uintptr ->
// unsafe.Pointer warning.
func uintptrToPointer(u uintptr) unsafe.Pointer {
	return *(*unsafe.Pointer)(unsafe.Pointer(&u))
}
