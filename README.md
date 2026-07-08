# AJRM Marine Pi Controller

AJRM Marine Pi Controller is a small Signal K plugin and webapp for a Raspberry Pi running a boat server.

It provides:

- Pi uptime, load, memory, disk space, CPU temperature, network address, and Signal K process information.
- Reboot and shutdown buttons, with confirmation.
- Piper status and a confirmed Piper installer action for AJRM Marine Audio.
- Configured SD-card backup target detection and a confirmed `rpi-clone`
  action for refreshing a Nemo SD-card clone.
- Configurable system commands so it can work on Raspberry Pi OS or another Linux distribution.

## Safety Notice

This software is Alpha Release and has not been tested in live environments and must not be relied upon for navigation or safety. The Authors do not accept any responsibility for loss or damage as a result of using this software.

The shutdown and restart controls can stop the Signal K server and power off the Pi. Keep this plugin available only on trusted boat networks.

## Install

On the Pi:

```bash
cd ~/.signalk
npm install git+https://github.com/ajrm-marine-suite/signalk-ajrm-marine-pi-controller.git#v0.5.11 --omit=dev --no-package-lock
sudo systemctl restart signalk
```

Open Signal K's webapps page and choose **AJRM Marine Pi Controller**.

## Signal K Config

The plugin config includes:

Version `0.5.7` installs the default Piper voice catalogue in nested voice
directories and makes Alba the preferred voice: Alba, Alan, and Jenny Dioco.

Version `1.2.5` adds Piper readiness reporting and a confirmed support action
for installing Piper and the default voice for AJRM Marine Audio.

Version `1.2.4` writes explicit power-intent breadcrumbs to the Signal K/systemd
journal so UPS shutdown tests can be reviewed after reboot.

- **Enable power controls**: shows and allows the Reboot and Shutdown buttons.
- **Enable support installers**: allows confirmed support actions such as
  installing Piper for AJRM Marine Audio.
- **Piper install command**: defaults to the package's bundled
  `scripts/install-piper.sh`, which installs the latest Piper GitHub release
  FFmpeg, and the default British English voice set on 64-bit Linux. Voice
  models are stored as `~/piper-voices/<voice-id>/<voice-id>.onnx`, currently
  including `en_GB-alba-medium`, `en_GB-alan-medium`, and
  `en_GB-jenny_dioco-medium`. Set `PIPER_VERSION`, `PIPER_ASSET`, or
  `PIPER_DOWNLOAD_URL` in the command only when deliberately testing or pinning
  a specific release. Set `INSTALL_FFMPEG=0` only when FFmpeg is managed
  separately and should not be installed by this action. The webapp shows the
  installer output in the Audio Support card. If Signal K cannot use `sudo`
  without an interactive password prompt, the installer fails early with a
  clear message because the web UI cannot answer password prompts.
- **Enable SD-card backup**: allows the webapp to run a confirmed `rpi-clone`
  backup to the configured USB device.
- **SD-card backup target label**: friendly name shown in the webapp, for
  example `Nemo SD-card backup USB`.
- **SD-card backup target serial**: preferred block-device serial number used
  to find the backup USB stick even when its `/dev/sdX` name changes.
- **SD-card backup fallback device**: optional fallback path such as `/dev/sda`.
  Use this only when the serial is unavailable. The plugin refuses to use the
  current boot device as the backup target.
- **rpi-clone command**: defaults to `sudo /usr/local/sbin/rpi-clone`. The
  plugin appends the detected target device name automatically and sends `yes`
  to the `rpi-clone` confirmation prompt after the web confirmation.
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
pi ALL=(root) NOPASSWD: /sbin/reboot, /sbin/shutdown, /usr/bin/mkdir, /usr/bin/tar, /usr/bin/ln, /usr/bin/apt-get, /usr/local/sbin/rpi-clone
```

Save, then test carefully:

```bash
sudo -n /sbin/reboot --help
sudo -n /sbin/shutdown --help
sudo -n /usr/bin/mkdir --help
sudo -n /usr/bin/apt-get --help
sudo -n /usr/local/sbin/rpi-clone --help
```

Those test commands should print help and should not ask for a password.

## API

The plugin exposes:

- `GET /plugins/signalk-ajrm-marine-pi-controller/status`
- `POST /plugins/signalk-ajrm-marine-pi-controller/actions/reboot`
- `POST /plugins/signalk-ajrm-marine-pi-controller/actions/shutdown`
- `POST /plugins/signalk-ajrm-marine-pi-controller/actions/install-piper`
- `POST /plugins/signalk-ajrm-marine-pi-controller/actions/backup-sd-card`

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
## License and commercial use

This software is licensed under the GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later). You may use, study, share, and modify it under that licence. If you modify it and make it available to users over a network, the corresponding source code must also be made available under the AGPL.

Commercial licensing is available by arrangement for organisations that want different terms.
