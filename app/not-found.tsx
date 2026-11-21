import Link from "next/link";

export default function NotFound() {
  return <main className="shell hero" id="main">
    <h1>Page unavailable</h1><p>Return to your workspace to find records you can access.</p><Link href="/">Return to workspace</Link>
  </main>;
}
