# One-time: builds Squall for iOS on EAS and submits it to TestFlight.
# You'll be asked to sign in to your Apple Developer account once (EAS then remembers the credentials).
# Answer "Yes" to: generate a new provisioning profile, create the App Store Connect app, and "Squall" as the name.
Set-Location $PSScriptRoot\app
npx -y eas-cli@latest build -p ios --profile production --auto-submit
