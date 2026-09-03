import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Market Watch | Financial Analysis Platform",
  description: "A local MVP for tracking US equity price movements.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
