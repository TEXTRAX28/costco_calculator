# Gather on Oracle Cloud Always Free

This setup uses one London VM, one password-protected Gather account, and one persistent attempt ledger. It starts with manual entry, the Costco demo, and the installable app. For the first hosted check, keep `OPENAI_REQUEST_LIMIT=0`. OpenAI API usage is billed separately from Oracle hosting.

## Create the VM in London

1. Create an Oracle **Free Tier** account and select **UK South (London)**, `uk-london-1`, as the home region. Oracle completes card verification on its site and may place a temporary hold. The home region stays fixed after signup. Keep the tenancy on Free Tier. [Oracle signup](https://www.oracle.com/cloud/free/) · [Signup instructions](https://docs.oracle.com/en-us/iaas/Content/GSG/Tasks/signingup_topic-Sign_Up_for_Free_Oracle_Cloud_Promotion.htm)
2. Create one compute instance named `gather-beta`. Choose an eligible Ubuntu LTS platform image and the `VM.Standard.A1.Flex` shape with **1 OCPU and 4 GB RAM**. Keep the default boot volume size and verify the instance and volume are within the tenancy's remaining **Always Free** allocations. Check the console's eligibility and cost estimate before creating anything. If London has no free capacity, use another London availability domain or try again later. Oracle can reclaim idle free instances. [Always Free compute and storage](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
3. Give the VM a public IPv4 address in a dedicated public subnet with an internet gateway. Upload the public half of your SSH key. In the subnet's security list, change the default TCP 22 rule to your public IPv4 address with a `/32` suffix. Check any attached network security groups for broader SSH rules. Allow public TCP 80 and 443 for Caddy's certificate and HTTPS sign-in. Port 4175 stays on loopback. On the Ubuntu image, allow TCP 80 and 443 in the existing guest firewall. Preserve Oracle's boot-volume firewall rules and follow its guidance for `/etc/iptables/rules.v4`. [Create an instance](https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/launchinginstance.htm) · [Oracle security rules](https://docs.oracle.com/en-us/iaas/Content/Network/Concepts/securityrules.htm) · [Oracle firewall guidance](https://docs.oracle.com/en-us/iaas/Content/Compute/known-issues.htm)

Once the instance is running, the public IP and Ubuntu SSH username identify the target. Keep the SSH private key on your computer. Use the IP assigned to this instance consistently so iPhone installs and drafts keep the same origin.

## Build the private beta

On the Ubuntu VM, install Node.js 24 from the ARM64 release and verify its published checksum. Install Caddy 2.11 or newer from its official package repository. Both examples below assume Node is installed at `/usr/local/bin/node`. [Node.js release files](https://nodejs.org/download/release/latest-v24.x/) · [Caddy packages](https://caddyserver.com/docs/install)

Transfer an archive of the approved Gather source to a staging directory on the VM. The source archive should contain the lockfile, source, and the `hosting` templates. Keep local environment files, keys, test state, Git metadata, and receipts out of the archive. Run the build from the extracted directory as the SSH user. Enter the approved contact email and the actual operator's name when prompted. Both values appear in the browser privacy notice.

```bash
npm ci
read -r -p 'Privacy contact email: ' GATHER_PRIVACY_EMAIL
read -r -p 'Operator name: ' GATHER_PRIVACY_OPERATOR
GATHER_PRIVACY_EMAIL="$GATHER_PRIVACY_EMAIL" \
  GATHER_PRIVACY_OPERATOR="$GATHER_PRIVACY_OPERATOR" npm run build
npm prune --omit=dev
```

On the first install, run these commands from the same directory. The unit creates private state at `/var/lib/gather`. Keep that directory across updates.

```bash
id -u gather >/dev/null 2>&1 || sudo useradd --system --user-group --no-create-home --shell /usr/sbin/nologin gather
sudo install -d -m 0755 /opt/gather
sudo install -d -m 0755 /opt/gather/scripts /opt/gather/src
sudo cp -r dist node_modules server /opt/gather/
sudo cp -r src/lib /opt/gather/src/
sudo install -m 0644 scripts/start.mjs /opt/gather/scripts/start.mjs
sudo install -d -m 0700 /etc/gather
if ! sudo test -e /etc/gather/server.env; then
  sudo install -m 0600 /dev/null /etc/gather/server.env
  printf '%s\n' 'OPENAI_REQUEST_LIMIT=0' | sudo tee /etc/gather/server.env >/dev/null
fi
sudo install -m 0644 hosting/gather.service.example /etc/systemd/system/gather.service
sudo systemctl daemon-reload
sudo systemctl enable --now gather
```

## Enable the single sign-in

Generate a strong password in your password manager and run `caddy hash-password` interactively. Create the root-owned environment file with `sudo install -m 0600 /dev/null /etc/caddy/gather.env` on the first install and edit it with `sudoedit /etc/caddy/gather.env`. Use the VM's actual public IPv4 address and paste the entire bcrypt hash after the equals sign.

```dotenv
GATHER_BETA_USER=gather
GATHER_BETA_IP=192.0.2.1
GATHER_BETA_PASSWORD_HASH=REPLACE_WITH_BCRYPT_HASH
```

Install `hosting/Caddyfile.oracle.example` as `/etc/caddy/Caddyfile` and `hosting/gather.caddy` beside it. Run `sudo systemctl edit caddy` and enter the following. The override validates the configuration before start and keeps the Caddy environment out of the service log.

```ini
[Service]
EnvironmentFile=/etc/caddy/gather.env
ExecStartPre=/usr/bin/caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile
ExecStart=
ExecStart=/usr/bin/caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
ExecReload=
```

Apply it with `sudo systemctl daemon-reload` and `sudo systemctl restart caddy`. Open the HTTPS address of the VM on the iPhone after the certificate is ready, then enter the Gather username and password. The IP certificate renews through Let's Encrypt, so this setup needs no domain purchase. [Caddy service configuration](https://caddyserver.com/docs/running) · [Let's Encrypt IP certificates](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability)

Before using the beta, confirm the app, manifest and API return 401 without the password, the authenticated status reports scanning disabled, and the privacy dialog displays the selected contact. Check Home Screen launch and the demo on the hosted address. Review the [privacy and release checklist](BETA_READINESS.md#before-inviting-testers) before enabling any real receipt processing. When it is enabled, keep the provider key in the server environment file, choose a small finite attempt limit and retain the same allowance ID and state directory across restarts. A London VM places the app and its disk in London. The OpenAI project's settings govern where receipt images are processed. [OpenAI data residency](https://developers.openai.com/api/docs/guides/data-residency)
