// Command agent is the OmniPrint on-premise monitoring agent. It polls
// printers over SNMP and reports metrics to the OmniPrint cloud API.
//
// Usage:
//
//	omniprint-agent -config config.yaml install   install as an OS service
//	omniprint-agent -config config.yaml start      start the installed service
//	omniprint-agent -config config.yaml stop       stop the installed service
//	omniprint-agent -config config.yaml uninstall  remove the installed service
//	omniprint-agent -config config.yaml            run in the foreground
package main

import (
	"flag"
	"log"
	"os"
	"path/filepath"
	"strconv"

	"github.com/kardianos/service"

	"github.com/omniprint/agent/internal/config"
	"github.com/omniprint/agent/internal/svc"
	"github.com/omniprint/agent/internal/updater"
)

var version = "dev"

func main() {
	configPath := flag.String("config", "config.yaml", "path to config file")
	showVersion := flag.Bool("version", false, "print version and exit")
	// Internal flag, not documented in the package comment above - only
	// ever invoked by Apply() itself, spawning the freshly-downloaded
	// binary as a detached helper. See internal/updater/apply_windows.go.
	applyUpdate := flag.Bool("apply-update", false, "internal: apply a downloaded update (do not run directly)")
	flag.Parse()

	if *showVersion {
		log.Printf("omniprint-agent %s", version)
		return
	}

	if *applyUpdate {
		oldExePath := flag.Arg(0)
		oldPID, err := strconv.Atoi(flag.Arg(1))
		if oldExePath == "" || err != nil {
			log.Fatalf("-apply-update requires <oldExePath> <oldPID> arguments")
		}
		if err := updater.RunHelper(oldExePath, oldPID); err != nil {
			log.Fatalf("apply update failed: %v", err)
		}
		return
	}

	action := flag.Arg(0)

	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
	}

	absConfigPath, err := filepath.Abs(*configPath)
	if err != nil {
		log.Fatalf("failed to resolve config path: %v", err)
	}

	if cfg.LogFile != "" {
		// A relative log_file is resolved against config.yaml's own directory,
		// not the process's working directory - a Windows service doesn't run
		// with the directory `install` was invoked from as its CWD, same
		// reasoning as absConfigPath above.
		logPath := cfg.LogFile
		if !filepath.IsAbs(logPath) {
			logPath = filepath.Join(filepath.Dir(absConfigPath), logPath)
		}
		f, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
		if err != nil {
			log.Fatalf("failed to open log file: %v", err)
		}
		defer f.Close()
		log.SetOutput(f)
	}

	svcInstance, err := svc.New(cfg, version, absConfigPath)
	if err != nil {
		log.Fatalf("failed to create service: %v", err)
	}

	if action != "" {
		if err := service.Control(svcInstance, action); err != nil {
			log.Fatalf("failed to %s service: %v", action, err)
		}
		log.Printf("service %s: OK", action)
		return
	}

	if err := svcInstance.Run(); err != nil {
		log.Fatal(err)
	}
}
