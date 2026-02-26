import "./globals.css";
import { Space_Grotesk } from "next/font/google";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata = {
  title: "Shary Incidents Dashboard",
  description: "Operations dashboard for Shary incidents",
  icons: {
    icon: "/favicon.svg",
  },
};

const themeInitScript = `
  (function () {
    try {
      var key = "incident_dashboard_theme";
      var saved = (localStorage.getItem(key) || "").toLowerCase();
      if (saved === "dark" || saved === "light" || saved === "sand" || saved === "green") {
        document.documentElement.setAttribute("data-theme", saved);
      } else {
        document.documentElement.setAttribute("data-theme", "green");
      }
    } catch (e) {}
  })();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="green">
      <body className={spaceGrotesk.className}>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {children}
      </body>
    </html>
  );
}
