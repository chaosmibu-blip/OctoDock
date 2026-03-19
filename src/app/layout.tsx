import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { I18nProvider } from "@/lib/i18n";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "OctoDock — One MCP URL. All Apps. Remembers You.",
    template: "%s | OctoDock",
  },
  description: "Connect Notion, Gmail, Google Calendar, GitHub, Drive, and 10+ apps through one MCP URL. Works with Claude, ChatGPT, Cursor, and any MCP-compatible AI tool. Cross-agent memory included.",
  keywords: ["MCP", "Model Context Protocol", "AI agent", "Notion", "Gmail", "GitHub", "Google Calendar", "OctoDock", "AI tools", "automation"],
  authors: [{ name: "OctoDock" }],
  creator: "OctoDock",
  metadataBase: new URL("https://octo-dock.com"),
  // Open Graph（社群分享預覽）
  openGraph: {
    type: "website",
    locale: "zh_TW",
    alternateLocale: "en_US",
    url: "https://octo-dock.com",
    siteName: "OctoDock",
    title: "OctoDock — One MCP URL. All Apps.",
    description: "Let any AI agent control all your apps through a single MCP URL. Cross-agent memory included.",
    images: [{ url: "/octodock-logo-preview.png", width: 1200, height: 630, alt: "OctoDock" }],
  },
  // Twitter Card
  twitter: {
    card: "summary_large_image",
    title: "OctoDock — One MCP URL. All Apps.",
    description: "Connect 16+ apps. Works with Claude, ChatGPT, Cursor. Cross-agent memory.",
    images: ["/octodock-logo-preview.png"],
  },
  icons: {
    icon: [
      { url: "/icon-512.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { url: "/icon-192.png", sizes: "32x32", type: "image/png" },
    ],
    shortcut: "/icon-512.svg",
    apple: "/apple-touch-icon.png",
  },
  // 其他 SEO
  robots: { index: true, follow: true },
  alternates: { canonical: "https://octo-dock.com" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <head>
        {/* Schema.org 結構化資料（SoftwareApplication）— 讓搜尋引擎理解產品類型 */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "SoftwareApplication",
              "name": "OctoDock",
              "applicationCategory": "DeveloperApplication",
              "operatingSystem": "Web",
              "description": "One MCP URL to let any AI agent use all your apps. Cross-agent memory included.",
              "url": "https://octo-dock.com",
              "image": "https://octo-dock.com/icon-512.png",
              "author": { "@type": "Organization", "name": "OctoDock" },
              "offers": {
                "@type": "Offer",
                "price": "0",
                "priceCurrency": "USD",
                "description": "Free tier available"
              },
              "featureList": [
                "Connect 16+ apps through one MCP URL",
                "Cross-agent memory (Claude, ChatGPT, Cursor)",
                "Auto-detect repeated workflows (SOP)",
                "Smart parameter suggestions"
              ]
            }),
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
