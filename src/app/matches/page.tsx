"use client";
import { Suspense } from "react";
import { JobBrowser } from "@/components/job-browser";
import { Loading } from "@/components/ui";

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <JobBrowser view="matches" />
    </Suspense>
  );
}
