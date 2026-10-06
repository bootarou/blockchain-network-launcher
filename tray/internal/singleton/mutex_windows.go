// Package singleton prevents a second copy of the tray application from running.
//
// Two resident instances would poll WSL twice and show two icons, so the second
// one exits immediately.
package singleton

import (
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	kernel32         = windows.NewLazySystemDLL("kernel32.dll")
	procCreateMutexW = kernel32.NewProc("CreateMutexW")
)

// Acquire creates a named mutex. It returns ok=false when another instance
// already holds it.
//
// The name is session-local ("Local\..."): one tray icon per logged-on user is
// the intent, and a global object would need a privilege we do not require.
func Acquire(name string) (release func(), ok bool) {
	namePtr, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return func() {}, true // never block startup over a name we cannot encode
	}

	handle, _, lastErr := procCreateMutexW.Call(0, 0, uintptr(unsafe.Pointer(namePtr)))
	if handle == 0 {
		return func() {}, true
	}
	if lastErr == windows.ERROR_ALREADY_EXISTS {
		windows.CloseHandle(windows.Handle(handle))
		return func() {}, false
	}
	return func() { windows.CloseHandle(windows.Handle(handle)) }, true
}
