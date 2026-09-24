"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

export async function setActiveCustomer(customerId: string | null) {
  const jar = await cookies();
  if (customerId && customerId !== "all") {
    jar.set("rrufe_customer_id", customerId, {
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
      sameSite: "lax",
    });
  } else if (customerId === "all") {
    jar.set("rrufe_customer_id", "all", {
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
      sameSite: "lax",
    });
  } else {
    jar.delete("rrufe_customer_id");
  }
  revalidatePath("/", "layout");
}
