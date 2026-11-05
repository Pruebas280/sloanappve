import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Proveedores from "@/components/ui/Proveedores";
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
  title: "adraz-sloan",
  description: "Sistema de Gestión y Control Empresarial",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Proveedores>{children}</Proveedores>
      </body>
    </html>
  );
}
