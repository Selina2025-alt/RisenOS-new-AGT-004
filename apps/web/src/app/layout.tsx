import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "RISEN Content Studio · AGT-004",
  description: "可审核、可复用、可交付的内容资产生产工作台",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
