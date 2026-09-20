//go:build !windows

package singleton

// Acquire always succeeds outside Windows; the application only ships for
// Windows.
func Acquire(name string) (release func(), ok bool) {
	return func() {}, true
}
