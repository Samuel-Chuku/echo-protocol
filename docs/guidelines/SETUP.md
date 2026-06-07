# Setup Guide — New Contributor

## Prerequisites Checklist

### 1. Node.js + Package Manager

```bash
# Check versions
node --version    # Should be >= 20
npm --version     # Should be >= 10

# If missing, install via nvm:
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
nvm install 22
nvm use 22
```

### 2. pnpm (Monorepo Package Manager)

```bash
npm install -g pnpm
pnpm --version    # Should be >= 9
```

### 3. Git + GitHub CLI

```bash
# Git (usually installed)
git --version

# GitHub CLI (recommended for PRs)
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
sudo chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
sudo apt update && sudo apt install gh
gh auth login
```

### 4. Foundry (Solidity Toolkit)

```bash
curl -L https://foundry.paradigm.xyz | bash
# Then restart your terminal or run:
source ~/.bashrc
foundryup
forge --version    # Should output version
```

### 5. PostgreSQL (for indexer local dev)

```bash
# Ubuntu/Debian:
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql

# macOS:
brew install postgresql
brew services start postgresql

# Create database:
psql -U postgres
create database echo_indexer;
\q
```

### 6. Vercel CLI (for web deployments)

```bash
npm install -g vercel
vercel login
```

---

## Repository Setup

```bash
# Clone the repo
git clone <YOUR_GITHUB_REPO_URL>
cd echo-protocol

# Install all dependencies
pnpm install

# Verify everything works
pnpm build        # Build all packages
forge test        # Run contract tests (will show no tests yet — OK)
```

---

## Environment Setup

```bash
# Copy environment template
cp .env.example .env

# Fill in YOUR values:
# - ARC_TESTNET_RPC_URL
# - CIRCLE_API_KEY
# - ENTITY_SECRET
# - POSTGRES_URL
# - WORLD_ID_APP_ID (Phase 2)
```

See `.env.example` for all required variables.

---

## GPG Commit Signing (Required)

```bash
# Generate GPG key
gpg --full-generate-key
# Select: RSA and RSA, 4096 bits, no expiration

gpg --list-secret-keys --keyid-format long
# Copy the key ID (looks like rsa4096/3AA5C34371567BD2)

gpg --armor --export <KEY_ID>
# Copy the output and paste into GitHub → Settings → SSH and GPG keys

git config --global user.signingkey <KEY_ID>
git config --global commit.gpgsign true
```

---

## Verify Setup

```bash
# Should all succeed:
echo "Node: $(node --version)"
echo "pnpm: $(pnpm --version)"
echo "Git: $(git --version)"
echo "Foundry: $(forge --version)"
echo "PostgreSQL: $(psql --version)"
echo "Vercel: $(vercel --version)"
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `forge: command not found` | Run `source ~/.bashrc` or restart terminal |
| `pnpm install` fails | Delete `node_modules` and `pnpm-lock.yaml`, retry |
| PostgreSQL connection refused | Ensure service is running: `sudo systemctl start postgresql` |
| Arc testnet RPC times out | Check connection, try alternate RPC from Arc docs |

---

*Need help? Open an issue tagged `question`.*
