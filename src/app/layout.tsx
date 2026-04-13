import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Site Manager MVP",
  description: "Upload a PDF, add pins, and attach photos locally in your browser.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
