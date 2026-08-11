import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Kangwifi Cam — Super HD HEIC Camera",
  description:
    "Aplikasi kamera Android dengan output HEIC, upscaling AI super HD jernih, foto/video/live photo, dan upload ke cloud kangwifi.",
  keywords: [
    "camera",
    "HEIC",
    "Android",
    "super HD",
    "upscale",
    "live photo",
    "video",
    "kangwifi",
    "cloud",
  ],
  authors: [{ name: "kangwifi" }],
  manifest: "/manifest.webmanifest",
  applicationName: "Kangwifi Cam",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Kangwifi Cam",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { url: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
    shortcut: ["/icon-192.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-black text-white overflow-hidden`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
