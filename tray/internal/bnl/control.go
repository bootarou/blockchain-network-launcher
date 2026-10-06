package bnl

import (
	"context"
	"sync"
	"time"

	"github.com/bootarou/bnl-tray/internal/logging"
	"github.com/bootarou/bnl-tray/internal/probe"
	"github.com/bootarou/bnl-tray/internal/wsl"
)

// Scripts run inside the distribution. They avoid double quotes so that the
// Windows command line passed to wsl.exe needs no additional escaping.
const (
	keepaliveScript = "pgrep -f '^bnl-wsl-keepalive ' >/dev/null 2>&1 || " +
		"nohup bash -c 'exec -a bnl-wsl-keepalive sleep 2147483647' " +
		">/var/log/bnl-wsl-keepalive.log 2>&1 </dev/null &"
	dockerStartScript = "systemctl start docker >/dev/null 2>&1 || service docker start >/dev/null 2>&1"
	dockerInfoScript  = "docker info >/dev/null 2>&1"
	composeUpScript   = "cd /opt/bnl && docker compose up -d symbol-manager"
	composeStopScript = "cd /opt/bnl && docker compose stop symbol-manager"
	composeLogsScript = "cd /opt/bnl && docker compose logs --tail 80 symbol-manager"
	installedScript   = "test -d /opt/bnl"
)

// Timeouts matching BNL-Start.bat's waiting loops.
const (
	startTimeout       = 3 * time.Minute
	stopTimeout        = time.Minute
	stepTimeout        = 30 * time.Second
	dockerWait         = 30 * time.Second
	webWait            = 60 * time.Second
	dockerPollEvery    = time.Second
	webPollEvery       = time.Second
	webPollTimeoutEach = 2 * time.Second
)

// Controller performs the Start and Stop operations by calling wsl.exe directly.
//
// This is the port of BNL-Start.bat / BNL-Stop.bat described in section 11 of
// the lifecycle spec: the batch files stay in the distribution package for Setup
// and Uninstall only.
type Controller struct {
	runner  *wsl.Runner
	monitor *Monitor
	log     *logging.Logger

	mu   sync.Mutex
	busy bool
}

// NewController wires a controller to its runner and monitor.
func NewController(runner *wsl.Runner, monitor *Monitor, log *logging.Logger) *Controller {
	return &Controller{runner: runner, monitor: monitor, log: log}
}

// Busy reports whether an operation is already running.
func (c *Controller) Busy() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.busy
}

func (c *Controller) acquire() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.busy {
		return false
	}
	c.busy = true
	return true
}

func (c *Controller) release() {
	c.mu.Lock()
	c.busy = false
	c.mu.Unlock()
}

// Progress receives step messages such as "[4/5] Starting Docker...".
type Progress func(message string)

// Start brings up the BNL manager, following the five steps of BNL-Start.bat.
// Symbol nodes are never touched.
func (c *Controller) Start(ctx context.Context, progress Progress) *Failure {
	if !c.acquire() {
		return nil
	}
	defer c.release()

	c.monitor.BeginTransition(StateStarting)
	failure := c.start(ctx, progress)
	c.monitor.EndTransition(failure)
	return failure
}

func (c *Controller) start(ctx context.Context, progress Progress) *Failure {
	ctx, cancel := context.WithTimeout(ctx, startTimeout)
	defer cancel()

	step := func(message string) {
		c.log.Infof("%s", message)
		progress(message)
	}

	step("[1/5] Starting Ubuntu...")
	pingCtx, cancelPing := context.WithTimeout(ctx, stepTimeout)
	err := c.runner.Ping(pingCtx)
	cancelPing()
	if err != nil {
		return c.fail(ErrWslStart, err)
	}

	step("[2/5] Checking BNL installation...")
	if _, err := c.bash(ctx, stepTimeout, installedScript); err != nil {
		return c.fail(ErrNotInstalled, err)
	}

	step("[3/5] Starting WSL keepalive...")
	if _, err := c.bash(ctx, stepTimeout, keepaliveScript); err != nil {
		return c.fail(ErrKeepalive, err)
	}

	step("[4/5] Starting Docker...")
	// Matching the batch file, a failure here is not fatal: Docker may already
	// be running, which is what the following poll actually verifies.
	if _, err := c.bash(ctx, stepTimeout, dockerStartScript); err != nil {
		c.log.Warnf("docker start command returned an error (continuing): %v", err)
	}
	if !c.waitFor(ctx, dockerWait, dockerPollEvery, func(pollCtx context.Context) bool {
		_, err := c.bash(pollCtx, stepTimeout, dockerInfoScript)
		return err == nil
	}) {
		return c.fail(ErrDockerTimeout, nil)
	}
	c.log.Infof("Docker is ready.")

	step("[5/5] Starting BNL manager...")
	if out, err := c.bash(ctx, startTimeout, composeUpScript); err != nil {
		c.log.Errorf("docker compose up failed: %v | %s", err, out)
		c.captureComposeLogs(ctx)
		return c.fail(ErrComposeUp, err)
	}

	step("Waiting for Web UI...")
	url := c.monitor.Snapshot().WebURL()
	if !c.waitFor(ctx, webWait, webPollEvery, func(pollCtx context.Context) bool {
		return probe.Reachable(pollCtx, url, webPollTimeoutEach)
	}) {
		c.captureComposeLogs(ctx)
		return c.fail(ErrWebUnreachable, nil)
	}

	c.log.Infof("BNL is running at %s", url)
	return nil
}

// Stop stops the BNL manager only. Symbol nodes, Docker, WSL and the keepalive
// process are left untouched (lifecycle spec section 4).
func (c *Controller) Stop(ctx context.Context, progress Progress) *Failure {
	if !c.acquire() {
		return nil
	}
	defer c.release()

	c.monitor.BeginTransition(StateStopping)

	c.log.Infof("Stopping BNL manager...")
	progress("Stopping BNL manager...")

	var failure *Failure
	if out, err := c.bash(ctx, stopTimeout, composeStopScript); err != nil {
		c.log.Errorf("docker compose stop failed: %v | %s", err, out)
		failure = c.fail(ErrComposeStop, err)
	} else {
		c.log.Infof("BNL manager stopped. Symbol nodes, Docker and WSL were not changed.")
	}

	c.monitor.EndTransition(failure)
	return failure
}

func (c *Controller) bash(ctx context.Context, timeout time.Duration, script string) (string, error) {
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	return c.runner.Bash(runCtx, script)
}

// waitFor polls until check succeeds or the budget runs out.
func (c *Controller) waitFor(ctx context.Context, budget, every time.Duration, check func(context.Context) bool) bool {
	deadline := time.Now().Add(budget)
	for {
		if check(ctx) {
			return true
		}
		if time.Now().After(deadline) || ctx.Err() != nil {
			return false
		}
		select {
		case <-ctx.Done():
			return false
		case <-time.After(every):
		}
	}
}

// captureComposeLogs writes the manager's recent output to the tray log, which
// is the only place the user can read it from.
func (c *Controller) captureComposeLogs(ctx context.Context) {
	out, err := c.bash(ctx, stepTimeout, composeLogsScript)
	if err != nil {
		c.log.Warnf("could not read symbol-manager logs: %v", err)
		return
	}
	c.log.Errorf("last symbol-manager logs:\n%s", out)
}

func (c *Controller) fail(failure *Failure, cause error) *Failure {
	result := failure
	if cause != nil {
		result = failure.withCause(cause)
	}
	c.log.Errorf("%s (%s)", result.Message, result.Hint)
	return result
}
