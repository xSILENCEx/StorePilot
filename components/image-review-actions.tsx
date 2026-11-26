"use client";
import { Button, Group, Text, Anchor } from "@mantine/core";
import { useState } from "react";
import { readApiResponse } from "../lib/api-response";
import { resolutionLabel, type ImageReview } from "../lib/image-resolution";
export function ImageReviewActions({
  id,
  review,
}: {
  id: string;
  review: ImageReview;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function decide(decision: "accept" | "enhance" | "retry" | "cancel") {
    setBusy(true);
    try {
      await readApiResponse(
        await fetch("/api/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reviewId: id, token: review.token, decision }),
        }),
      );
      setMessage(
        decision === "cancel" ? "已停止批次" : "已提交处理，稍后刷新结果",
      );
    } catch (error) {
      setBusy(false);
      setMessage(error instanceof Error ? error.message : "提交失败");
    }
  }
  return (
    <div>
      <Text size="sm">{resolutionLabel(review)}</Text>
      <Anchor href={review.url} target="_blank" rel="noreferrer">
        {review.sample ? "查看首张样图" : "查看模型原图"}
      </Anchor>
      <Group gap="xs" mt="xs">
        <Button
          size="xs"
          disabled={busy}
          onClick={() => void decide(review.sample ? "accept" : "enhance")}
        >
          {review.sample ? "采用首张并继续" : "超分后采用"}
        </Button>
        <Button
          size="xs"
          variant="default"
          disabled={busy}
          onClick={() => void decide("retry")}
        >
          重新生成（可能计费）
        </Button>
        <Button
          size="xs"
          variant="subtle"
          disabled={busy}
          onClick={() => void decide("cancel")}
        >
          停止批次
        </Button>
      </Group>
      {message && <Text size="xs">{message}</Text>}
    </div>
  );
}
