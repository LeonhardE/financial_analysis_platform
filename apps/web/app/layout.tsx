import type { Metadata } from "next";
import { AuthProvider } from "@/components/AuthProvider";
import { PreferencesProvider } from "@/components/PreferencesProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "FolioView — Your investing workspace",
  description:
    "Follow the US market, explore stock charts, and keep your personal watchlist in one investing workspace.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <PreferencesProvider>{children}</PreferencesProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
