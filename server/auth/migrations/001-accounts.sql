CREATE TABLE gather_users (
  id uuid PRIMARY KEY,
  created_at bigint NOT NULL
);

CREATE TABLE gather_identities (
  issuer text NOT NULL,
  subject text NOT NULL,
  user_id uuid REFERENCES gather_users(id) ON DELETE CASCADE,
  email text,
  blocked_until bigint NOT NULL DEFAULT 0,
  reject_auth_through bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (issuer, subject)
);
CREATE INDEX gather_identities_user ON gather_identities(user_id);

CREATE TABLE gather_sessions (
  token_hash bytea PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES gather_users(id) ON DELETE CASCADE,
  issuer text NOT NULL,
  subject text NOT NULL,
  created_at bigint NOT NULL,
  last_seen bigint NOT NULL,
  expires_at bigint NOT NULL,
  FOREIGN KEY (issuer, subject) REFERENCES gather_identities(issuer, subject) ON DELETE CASCADE
);
CREATE INDEX gather_sessions_user ON gather_sessions(user_id);
CREATE INDEX gather_sessions_expiry ON gather_sessions(expires_at);

CREATE TABLE gather_oauth_attempts (
  token_hash bytea PRIMARY KEY,
  state text NOT NULL,
  nonce text NOT NULL,
  verifier text NOT NULL,
  destination text NOT NULL,
  expires_at bigint NOT NULL
);
CREATE INDEX gather_oauth_expiry ON gather_oauth_attempts(expires_at);

CREATE TABLE gather_auth_limits (
  bucket_key bytea NOT NULL,
  window_end bigint NOT NULL,
  attempts integer NOT NULL,
  PRIMARY KEY (bucket_key, window_end)
);
CREATE INDEX gather_auth_limits_expiry ON gather_auth_limits(window_end);

CREATE TABLE gather_saved_documents (
  owner_id uuid NOT NULL REFERENCES gather_users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('receipts', 'groups')),
  id uuid NOT NULL,
  title text NOT NULL,
  payload jsonb NOT NULL,
  saved_at bigint NOT NULL,
  PRIMARY KEY (owner_id, kind, id)
);
CREATE INDEX gather_saved_documents_history ON gather_saved_documents(owner_id, kind, saved_at DESC, id);
