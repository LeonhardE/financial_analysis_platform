import type { Metadata } from "next";
import { AuthProvider } from "@/components/AuthProvider";
import { PreferencesProvider } from "@/components/PreferencesProvider";
import { CurrencyPreferencesProvider } from "@/components/CurrencyPreferencesProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "FolioView — Your investing workspace",
  description:
    "Follow the US market, explore stock charts, and keep your personal watchlist in one investing workspace.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="light">
      <body>
        <AuthProvider>
          <PreferencesProvider>
            <CurrencyPreferencesProvider>{children}</CurrencyPreferencesProvider>
          </PreferencesProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
