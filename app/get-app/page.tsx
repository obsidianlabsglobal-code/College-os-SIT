import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";

export const metadata: Metadata = { title: "Get the app · NEXUS College OS" };

// ID-016: public install guide. The device's own steps come first; everything else stays below.
type Device = "android" | "iphone" | "laptop";
export default async function GetApp() {
  const ua = (await headers()).get("user-agent") ?? "";
  const first: Device = /android/i.test(ua) ? "android" : /iphone|ipad|ipod/i.test(ua) ? "iphone" : "laptop";
  const apk = process.env.NEXUS_ANDROID_APK_URL?.startsWith("https://") ? process.env.NEXUS_ANDROID_APK_URL : null;
  const sections: Record<Device, React.ReactNode> = {
    android: <section key="android" className="panel stack" aria-labelledby="android-title">
      <h2 id="android-title">Android phone</h2>
      {apk ? <p><a className="button" href={apk} download>Download the app (APK)</a></p>
        : <p>The college shares the app download link. Until then, open this site in Chrome and choose <strong>Install app</strong> from the ⋮ menu.</p>}
      <ol className="items">
        <li>Open the downloaded file. If Android asks, allow installs from this source (Settings → Apps → Special access → Install unknown apps → your browser).</li>
        <li>Tap <strong>Install</strong>, then open NEXUS College OS and sign in.</li>
        <li>Allow notifications so bus and class alerts reach you.</li>
      </ol>
      <p className="meta">Updates arrive by themselves; you never reinstall for a new version.</p>
    </section>,
    iphone: <section key="iphone" className="panel stack" aria-labelledby="iphone-title">
      <h2 id="iphone-title">iPhone</h2>
      <ol className="items">
        <li>Open this site in <strong>Safari</strong>.</li>
        <li>Tap the <strong>Share</strong> button, then <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
        <li>Open NEXUS from your home screen and sign in. Alerts on iPhone work only from the home-screen app (iOS 16.4 or later).</li>
      </ol>
    </section>,
    laptop: <section key="laptop" className="panel stack" aria-labelledby="laptop-title">
      <h2 id="laptop-title">Laptop or desktop</h2>
      <ol className="items">
        <li><strong>Chrome or Edge:</strong> click the install icon at the right of the address bar, then <strong>Install</strong>.</li>
        <li><strong>Mac Safari:</strong> choose <strong>File → Add to Dock</strong>.</li>
      </ol>
    </section>,
  };
  const order: Device[] = [first, ...(["android", "iphone", "laptop"] as Device[]).filter(d => d !== first)];
  return <main className="app-main stack" id="main" style={{ maxWidth: "44rem", marginInline: "auto" }}>
    <h1>Get the app</h1>
    <p>Install NEXUS College OS on your phone or laptop. It opens like any app, keeps you signed in on your own device, and gets alerts.</p>
    {order.map(d => sections[d])}
    <p><Link href="/">Open in this browser instead</Link></p>
  </main>;
}
