import { redirect } from "next/navigation";

/**
 * The console has no dashboard — an inspector arriving at the station wants the
 * bench, so the root sends them straight there.
 */
export default function Home() {
  redirect("/inspect");
}
