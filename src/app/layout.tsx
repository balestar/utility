import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { PinLock } from "@/components/pin-lock";
import { PanicButton } from "@/components/panic-button";
import { Sidebar } from "@/components/sidebar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Utility",
  description: "Remote administration tool",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#09090b",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        <link rel="icon" href="/icons/icon-192.svg" sizes="192x192" type="image/svg+xml" />
        <meta name="theme-color" content="#09090b" />
        <link rel="apple-touch-icon" href="/icons/icon-192.svg" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="application-name" content="Utility" />
      </head>
      <body className="flex h-full overflow-hidden bg-[#050508]">
        <PinLock>
          <div className="flex h-full w-full overflow-hidden">
            <Sidebar />
            <main className="flex flex-1 flex-col overflow-hidden">
              {/* Top bar */}
              <div className="flex h-10 shrink-0 items-center justify-between border-b border-white/[0.04] bg-[#06060c] px-5 md:px-6">
                <span className="font-mono text-[9px] uppercase tracking-widest text-slate-700">
                  UTILITY · COMMAND CENTER
                </span>
                <div className="flex items-center gap-3">
                  <span className="h-1 w-1 rounded-full bg-green-500 status-pulse" />
                  <span className="text-[9px] uppercase tracking-widest text-slate-700">SECURE</span>
                </div>
              </div>
              <div className="flex-1 overflow-auto p-4 pt-16 md:pt-4">
                {children}
              </div>
            </main>
          </div>
          <PanicButton />
        </PinLock>
      </body>
    </html>
  );
}
