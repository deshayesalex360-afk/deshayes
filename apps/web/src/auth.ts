import { env } from "@/lib/env";

export type DemoSession = {
  user: { email: string; name: string };
};

export async function auth(): Promise<DemoSession> {
  return {
    user: {
      email: env.DEMO_EMAIL,
      name: "Demo User",
    },
  };
}
