import type { Metadata } from "next";
import { JetBrains_Mono, Newsreader, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const uiFont = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-ui",
  weight: ["400", "500", "600", "700"],
});

const headingFont = Newsreader({
  subsets: ["latin"],
  variable: "--font-heading",
  weight: ["500", "600"],
  style: ["normal", "italic"],
});

const monoFont = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono-ui",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Dashboard Kelurahan Digital",
  description: "Dashboard admin layanan administrasi kelurahan (KK, Akte Kematian, Akte Kelahiran).",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" className={`h-full antialiased ${uiFont.variable} ${headingFont.variable} ${monoFont.variable}`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
