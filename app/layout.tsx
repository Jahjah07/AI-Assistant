import type { Metadata } from "next";
import localFont from "next/font/local";
import Appearance from "./components/Appearance";
import "./globals.css";

const orbitron = localFont({
  src: "./fonts/Orbitron.ttf",
  variable: "--font-orbitron",
  weight: "400 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Jimmy | Arc Reactor",
  description: "Your local voice assistant with an arc reactor clock.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${orbitron.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col"><Appearance />{children}</body>
    </html>
  );
}
