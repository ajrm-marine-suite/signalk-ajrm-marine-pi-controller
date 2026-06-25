# AJRM Marine Pi Controller

AJRM Marine Pi Controller is a small Signal K plugin and webapp for a Raspberry Pi running a boat server.

It provides:

- Pi uptime, load, memory, disk space, CPU temperature, network address, and Signal K process information.
- Reboot and shutdown buttons, with confirmation.
- Piper status and a confirmed Piper installer action for AJRM Marine Audio.
- Configurable system commands so it can work on Raspberry Pi OS or another Linux distribution.

## Safety Notice

This software is Alpha Release and has not been tested in live environments and must not be relied upon for navigation or safety. The Authors do not accept any responsibility for loss or damage as a result of using this software.

The shutdown and restart controls can stop the Signal K server and power off the Pi. Keep this plugin available only on trusted boat networks.

## Install

On the Pi:

```bash
cd ~/.signalk
npm install git+ssh://git@ssh.github.com:443/ajrm-marine-suite/signalk-ajrm-marine-pi-controller.git#v0.5.0 --omit=dev --no-package-lock
sudo systemctl restart signalk
```

Open Signal K's webapps page and choose **AJRM Marine Pi Controller**.

## Signal K Config

The plugin config includes:

Version `1.2.5` adds Piper readiness reporting and a confirmed support action
for installing Piper and the default voice for AJRM Marine Audio.

Version `1.2.4` writes explicit power-intent breadcrumbs to the Signal K/systemd
journal so UPS shutdown tests can be reviewed after reboot.

- **Enable power controls**: shows and allows the Reboot and Shutdown buttons.
- **Enable support installers**: allows confirmed support actions such as
  installing Piper for AJRM Marine Audio.
- **Piper install command**: defaults to the package's bundled
  `scripts/install-piper.sh`, which installs Piper and the default
  `en_GB-alan-medium` voice on 64-bit Raspberry Pi OS.
- **Reboot command**: defaults to `sudo /sbin/reboot`.
- **Shutdown command**: defaults to `sudo /sbin/shutdown -h now`.
- **Power action grace period**: defaults to ten seconds. AJRM Marine Pi Controller
  publishes `vessels.self.plugins.ajrmMarinePiController.power.intent` before running
  the configured command so other AJRM Marine apps can close files cleanly.
- **Scheduled shutdown watch interval**: defaults to two seconds. AJRM Marine Pi Controller
  also watches systemd for shutdowns scheduled by external tools such as
  `powerDown` and publishes the same power intent for AJRM Marine apps.
- **Disk paths to monitor**: defaults to `/`.
- **Status refresh interval**: defaults to five seconds.

External tools can stay standalone by scheduling a normal OS shutdown, for
example:

```bash
sudo shutdown -h +1 "System shutting down soon"
```

## Sudo Permissions

For the reboot, shutdown, and Piper install buttons to work from Signal K, the
Signal K user must be allowed to run the configured commands.

On a Raspberry Pi where Signal K runs as user `pi`, create a sudoers file:

```bash
sudo visudo -f /etc/sudoers.d/signalk-ajrm-marine-pi-controller
```

Add:

```text
pi ALL=(root) NOPASSWD: /sbin/reboot, /sbin/shutdown, /usr/bin/mkdir, /usr/bin/tar, /usr/bin/ln
```

Save, then test carefully:

```bash
sudo -n /sbin/reboot --help
sudo -n /sbin/shutdown --help
sudo -n /usr/bin/mkdir --help
```

Those test commands should print help and should not ask for a password.

## API

The plugin exposes:

- `GET /plugins/signalk-ajrm-marine-pi-controller/status`
- `POST /plugins/signalk-ajrm-marine-pi-controller/actions/reboot`
- `POST /plugins/signalk-ajrm-marine-pi-controller/actions/shutdown`
- `POST /plugins/signalk-ajrm-marine-pi-controller/actions/install-piper`

The webapp asks for confirmation before sending a power action. Power action
requests require JSON:

```json
{
  "confirmed": true
}
```


## Public Beta

Raspberry Pi control and dependency helper for AJRM Marine Suite.

Development assistance: OpenAI Codex helped with code generation, refactoring, and automated testing during the beta development cycle.
