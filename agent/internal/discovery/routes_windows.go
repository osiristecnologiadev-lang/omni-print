//go:build windows

package discovery

import (
	"encoding/binary"
	"fmt"
	"net"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	iphlpapi              = windows.NewLazySystemDLL("iphlpapi.dll")
	procGetIpForwardTable = iphlpapi.NewProc("GetIpForwardTable")
)

// mibIPForwardRowSize is sizeof(MIB_IPFORWARDROW): 14 DWORDs, starting with
// dwForwardDest and dwForwardMask (both in network byte order).
const mibIPForwardRowSize = 14 * 4

// routedNetworks lists every IPv4 route destination in this host's routing
// table as a CIDR - autoNetworks keeps only the private, sweepable ones.
func routedNetworks() ([]string, error) {
	var size uint32
	procGetIpForwardTable.Call(0, uintptr(unsafe.Pointer(&size)), 0)
	if size == 0 {
		return nil, nil
	}
	buf := make([]byte, size)
	if rc, _, _ := procGetIpForwardTable.Call(uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&size)), 0); rc != 0 {
		return nil, fmt.Errorf("GetIpForwardTable: %w", windows.Errno(rc))
	}

	n := binary.LittleEndian.Uint32(buf[:4])
	var out []string
	for i := uint32(0); i < n; i++ {
		off := 4 + int(i)*mibIPForwardRowSize
		if off+mibIPForwardRowSize > len(buf) {
			break
		}
		dest := net.IP(append([]byte{}, buf[off:off+4]...))
		mask := net.IPMask(append([]byte{}, buf[off+4:off+8]...))
		if _, bits := mask.Size(); bits == 0 { // not a contiguous mask
			continue
		}
		out = append(out, (&net.IPNet{IP: dest.Mask(mask), Mask: mask}).String())
	}
	return out, nil
}
