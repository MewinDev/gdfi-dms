import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Inter (SIL Open Font License 1.1, app/fonts/Inter-OFL-LICENSE.txt), self-hosted so the build and the pages never
// call an outside host (D-057): the same variable font (latin, weights 100 to 900) Google Fonts used to serve.
const inter = localFont({ src: "./fonts/inter-latin-wght-normal.woff2", weight: "100 900", style: "normal", variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: { default: "GDFI DMS", template: "%s | GDFI DMS" },
  description: "Loan Document Management System of Global Dominion Financing, Inc.",
  icons: { icon: "/favicon.ico" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
