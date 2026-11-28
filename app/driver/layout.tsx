import type {Metadata} from "next";
import type {ReactNode} from "react";
import "./driver.css";

export const metadata:Metadata={
  title:"NEXUS Driver",icons:{icon:"/driver-assets/icon.svg",apple:"/driver-assets/icon-180.png"},manifest:"/driver/manifest.webmanifest",appleWebApp:{capable:true,title:"NEXUS Driver",statusBarStyle:"default"},
};
export default function DriverLayout({children}:{children:ReactNode}) { return children; }
