# Kanakku — personal expense tracker (Stage 1)

Reads bank and UPI SMS on your phone, plus bank alert emails from Gmail, and turns them into an expense book. Everything stays on the phone.

## What it does
- First open: reads the last 120 days of bank/UPI SMS. After that it checks for new messages every time you open the app.
- Picks up amount, paid/received, payee, UPI/card/ATM/NEFT, bank, last 4 digits of the account, and UPI reference.
- Skips OTPs, collect requests, failed/declined payments, "will be debited" warnings and promos.
- Avoids double counting: credit-card bill payments are left out of totals (the card spends are already counted), and the same payment reported twice (same reference + amount) is recorded once.
- Auto-categories (Food, Groceries, Fuel, KSEB/Bills, Mobile, Shopping, Travel, Health, EMI, Insurance, Investments, …). Change a category once and tick "use for all" — every past and future payment to that payee follows.
- ＋ Add: manual entries, both Paid and Received.
- Your own categories for expenses and income (＋ New inside any category list, or Overview → Manage categories).
- Month view: spent, received, net, category bars, top payees. Export the month as CSV (share to WhatsApp, Drive, email).

## Build the APK (same as your other apps)
1. Push this folder to a GitHub repo (branch `main`).
2. GitHub → Actions → **Build APK** runs automatically (or press *Run workflow*).
3. Download `kanakku-apk` from the run, unzip, install on the phone (allow "install unknown apps").
4. Open Kanakku → **Read my bank messages** → allow SMS access.

Note: SMS reading only works in a sideloaded APK; Play Store restricts this permission.

## Bank emails (Gmail) — one-time Google setup
Kanakku reads bank alert emails with read-only Gmail access. Google needs to know the app first (free, ~10 minutes, from a computer):

1. Open https://console.cloud.google.com → create a project named **Kanakku**.
2. **APIs & Services → Library** → search **Gmail API** → **Enable**.
3. **Google Auth Platform → Branding / Get started**: app name *Kanakku*, your email as support and developer contact. Audience: **External**.
4. **Audience → Test users** → add `mohandasrajadhani@gmail.com` (and any other Gmail you will connect).
5. **Data access → Add or remove scopes** → add `https://www.googleapis.com/auth/gmail.readonly` → Save.
6. **Clients → Create client** → type **Android**:
   - Package name: `com.mohandas.kanakku`
   - SHA-1: `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`
7. In the app: Overview → **Connect Gmail** → pick your account → Google shows "app isn't verified" → **Continue** (it's your own app).

While the Google app stays in *Testing*, Google asks you to sign in again about once a week — the app shows "Gmail sign-in has expired"; just tap Connect Gmail again.

## Accounts
- **Accounts tab**: bank accounts, credit cards, wallets and cash, with balances and card dues.
- Accounts found in your SMS (bank + last digits) are suggested for one-tap adding.
- Balance = the latest balance printed in a bank SMS ("Avl Bal …"), or the one you set, plus later entries.
- Cards: amount due and available limit (from "Avl Limit" in SMS when present, else limit − spends + payments).
- Cash wallet: ATM withdrawals go in, cash spends come out (ATM entries are then not counted as spending).
- Moves between your own accounts (same amount out of one and into another within 3 hours, card bill payments) are left out of spending/income. Anything you change by hand is never overridden.
- Link or re-link any entry from its detail screen; filter Transactions by account.
- **Check balance with bank** (bank accounts): opens the dialer with the bank's missed-call balance number (editable per account). The bank's reply SMS is read automatically and resets the balance. Balance-only SMS are always used this way.
- Tap an account → **Show how this was worked out**: the starting figure and every entry added after it.

## Backup
- Data is stored in an on-phone SQLite database (one row per entry). Older versions' data moves across automatically on first open.
- **Turn on Drive backup** (Overview → Backup): saves to a private Kanakku folder in your Google Drive (`drive.appdata` — the app cannot see your other Drive files). Automatic every week, last 5 kept. **Back up now** any time.
- **Restore**: pick a Drive backup, or **From a file**. Restoring replaces what is on the phone.
- **Save backup file**: share a `.json` copy anywhere (WhatsApp to yourself, Files, Drive).
- One-time Google setup: enable the **Google Drive API** in the Kanakku Google Cloud project (kanakku-513517).

## Updates
Every APK is signed with the same key (`credentials/kanakku.keystore`) and gets a higher version number, so a new build installs straight over the old one and keeps your data.

## Next
Bill reminders — electricity, phone, credit card statements, insurance — with due dates and alerts on the phone.
