import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="card max-w-md p-6 text-center">
        <h1 className="h1">Not found</h1>
        <p className="mt-2 text-sm text-ink-2">We could not find this page or loan file. It may belong to a branch you do not work in.</p>
        <Link href="/loans" className="btn-navy mt-4">Go to my loans</Link>
      </div>
    </main>
  );
}
