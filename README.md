# Kanakku — personal expense tracker (Stage 1)

Reads bank and UPI SMS on your phone and turns them into an expense book. Everything stays on the phone.

## What it does
- First open: reads the last 120 days of bank/UPI SMS. After that it checks for new messages every time you open the app.
- Picks up amount, paid/received, payee, UPI/card/ATM/NEFT, bank, last 4 digits of the account, and UPI reference.
- Skips OTPs, collect requests, failed/declined payments, "will be debited" warnings and promos.
- Avoids double counting: credit-card bill payments are left out of totals (the card spends are already counted), and the same payment reported twice (same reference + amount) is recorded once.
- Auto-categories (Food, Groceries, Fuel, KSEB/Bills, Mobile, Shopping, Travel, Health, EMI, Insurance, Investments, …). Change a category once and tick "use for all" — every past and future payment to that payee follows.
- Cash expenses with the ＋ Cash button.
- Month view: spent, received, net, category bars, top payees. Export the month as CSV (share to WhatsApp, Drive, email).

## Build the APK (same as your other apps)
1. Push this folder to a GitHub repo (branch `main`).
2. GitHub → Actions → **Build APK** runs automatically (or press *Run workflow*).
3. Download `kanakku-apk` from the run, unzip, install on the phone (allow "install unknown apps").
4. Open Kanakku → **Read my bank messages** → allow SMS access.

Note: SMS reading only works in a sideloaded APK; Play Store restricts this permission.

## Stage 2 (next)
Gmail bill scan — electricity, phone, credit card statements, insurance — with due dates and reminders on the phone.
