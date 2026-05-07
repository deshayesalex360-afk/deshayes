import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { loginAction } from "./actions";

export default async function Home() {
  const session = await auth();
  if (session) redirect("/dashboard");
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center px-6 py-12">
      <h1 className="text-4xl font-semibold">Vizard-like SaaS MVP+</h1>
      <p className="mt-3 max-w-2xl text-zinc-600 dark:text-zinc-300">
        Upload long videos, auto-transcribe, generate AI clip suggestions, and
        export social-ready videos with subtitles and custom ratio.
      </p>
      <div className="mt-8 grid gap-3 text-sm">
        <p>1) Upload + transcribe</p>
        <p>2) AI clip suggestions</p>
        <p>3) Export 9:16, 1:1, 16:9 with burned subtitles</p>
      </div>
      <form action={loginAction} className="mt-10 grid max-w-sm gap-3">
        <input
          className="rounded border p-2"
          name="email"
          type="email"
          defaultValue="demo@vizard.local"
        />
        <input
          className="rounded border p-2"
          name="password"
          type="password"
          defaultValue="change-me-123"
        />
        <button className="rounded bg-black px-4 py-2 text-white">
          Sign in demo
        </button>
      </form>
    </div>
  );
}
