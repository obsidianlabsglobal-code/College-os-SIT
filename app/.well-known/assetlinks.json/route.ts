import { NextResponse } from "next/server";

// ID-016: Digital Asset Links for the Android Trusted Web Activity, so the APK opens full screen with no browser bar.
// Configured per deployment: NEXUS_ANDROID_PACKAGE (e.g. org.example.collegeos) and NEXUS_ANDROID_SHA256 (one or more
// signing-certificate fingerprints, comma-separated, AA:BB:… form). Unset → 404, so nothing is claimed by default.
export const dynamic = "force-dynamic";
const fingerprint = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

export function GET() {
  const pkg = process.env.NEXUS_ANDROID_PACKAGE?.trim() ?? "";
  const prints = (process.env.NEXUS_ANDROID_SHA256 ?? "").split(",").map(p => p.trim().toUpperCase()).filter(Boolean);
  if (!/^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/.test(pkg) || !prints.length || !prints.every(p => fingerprint.test(p)))
    return new NextResponse(null, { status: 404 });
  return NextResponse.json([{ relation: ["delegate_permission/common.handle_all_urls"],
    target: { namespace: "android_app", package_name: pkg, sha256_cert_fingerprints: prints } }],
  { headers: { "Cache-Control": "public, max-age=3600" } });
}
