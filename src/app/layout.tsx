import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { PinLock } from "@/components/pin-lock";
import { PanicButton } from "@/components/panic-button";
import { Sidebar } from "@/components/sidebar";
import { ServiceWorkerRegistrar } from "@/components/sw-registrar";
import { ToastProvider } from "@/components/toast";
import { CommandPalette } from "@/components/command-palette";
import { TopBar } from "@/components/top-bar";

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
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Utility",
  },
};

export const viewport: Viewport = {
  themeColor: "#050508",
  width: "device-width",
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        <link rel="icon" href="/icons/icon-192.svg" sizes="192x192" type="image/svg+xml" />
        <meta name="theme-color" content="#050508" />
        <link rel="apple-touch-icon" href="/icons/icon-192.svg" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="application-name" content="Utility" />
      </head>
      <body className="flex h-full overflow-hidden bg-[#050508]">
        <ToastProvider>
          <PinLock>
            <div className="flex h-full w-full overflow-hidden">
              <Sidebar />
              <main className="flex flex-1 flex-col overflow-hidden">
                <TopBar />
                <div className="flex-1 overflow-auto p-4 pt-16 md:pt-4">
                  {children}
                </div>
              </main>
            </div>
            <PanicButton />
            <CommandPalette />
            <ServiceWorkerRegistrar />
          </PinLock>
        </ToastProvider>
      </body>
    </html>
  );
}
