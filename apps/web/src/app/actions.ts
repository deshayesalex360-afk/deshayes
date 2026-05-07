"use server";

import { redirect } from "next/navigation";
import { env } from "@/lib/env";

export async function loginAction(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  if (email !== env.DEMO_EMAIL || password !== env.DEMO_PASSWORD) {
    redirect("/");
  }
  redirect("/dashboard");
}

export async function logoutAction() {
  redirect("/");
}
