## ADDED Requirements

### Requirement: nginx serves all traffic over HTTPS with valid TLS certificate
All HTTP traffic SHALL be redirected to HTTPS. TLS termination SHALL occur at nginx. Certificates SHALL be provisioned automatically via Let's Encrypt Certbot and renewed without manual intervention.

#### Scenario: HTTP request is redirected to HTTPS
- **WHEN** a client sends an HTTP request to port 80
- **THEN** nginx responds with HTTP 301 to the same URL on port 443

#### Scenario: HTTPS request is served with valid certificate
- **WHEN** a client connects to port 443
- **THEN** nginx presents a valid Let's Encrypt certificate for the configured domain
- **THEN** the TLS handshake completes without certificate errors

#### Scenario: Certificate is provisioned on first deploy
- **WHEN** `init-letsencrypt.sh` is executed with `DOMAIN` and `CERTBOT_EMAIL` set
- **THEN** Certbot obtains a certificate from Let's Encrypt for `DOMAIN`
- **THEN** the certificate is stored in `devOps/ssl/certbot/conf/live/{DOMAIN}/`

#### Scenario: Certificate renews automatically
- **WHEN** a certificate has less than 30 days remaining
- **THEN** the Certbot container cronjob (running every 12h) renews it automatically
- **THEN** nginx reloads its configuration without downtime

### Requirement: nginx-ssl.conf configures secure TLS settings
The nginx SSL configuration SHALL use TLS 1.2+ only, strong cipher suites, HSTS header, and OCSP stapling.

#### Scenario: Insecure TLS versions are rejected
- **WHEN** a client attempts to connect with TLS 1.0 or 1.1
- **THEN** nginx rejects the connection

#### Scenario: HSTS header is present
- **WHEN** a valid HTTPS response is returned
- **THEN** the response includes `Strict-Transport-Security: max-age=31536000; includeSubDomains`

### Requirement: Self-signed certificate config is available for local testing
A `nginx-selfsigned.conf` SHALL be provided for development environments where Let's Encrypt is not available. A `generate-selfsigned.sh` script SHALL generate the self-signed certificate.

#### Scenario: Local HTTPS works without a public domain
- **WHEN** `generate-selfsigned.sh` is run locally
- **THEN** a self-signed certificate is generated in `devOps/ssl/selfsigned/`
- **THEN** nginx can be started with `nginx-selfsigned.conf` for local TLS testing
