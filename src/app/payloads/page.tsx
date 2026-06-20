import { PayloadGenerator } from "@/components/payload-generator";

export default function PayloadsPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Payloads</h1>
        <p className="mt-1 text-sm text-zinc-500">Generate and download remote access payloads</p>
      </div>
      <PayloadGenerator />
    </div>
  );
}
