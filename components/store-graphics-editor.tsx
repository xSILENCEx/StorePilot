"use client";
import { useState } from "react";
import {
  Button,
  FileButton,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  graphicLabels,
  graphicTypes,
  type Draft,
  type GraphicType,
} from "../lib/model";

export function StoreGraphicsEditor({
  draft,
  enabled,
  updateDraft,
}: {
  draft: Draft;
  enabled: boolean;
  updateDraft: (fn: (current: Draft) => Partial<Draft>) => void;
}) {
  const [uploading, setUploading] = useState<GraphicType | null>(null);
  function setGraphic(type: GraphicType, url?: string) {
    updateDraft((current) => {
      const graphics = { ...current.graphics };
      if (url) graphics[type] = url;
      else delete graphics[type];
      return { graphics };
    });
  }
  async function upload(type: GraphicType, file: File | null) {
    if (!file) return;
    setUploading(type);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/assets", {
        method: "POST",
        body: form,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "上传失败");
      setGraphic(type, result.url);
    } catch (error) {
      notifications.show({
        color: "red",
        message: error instanceof Error ? error.message : "上传失败",
      });
    } finally {
      setUploading(null);
    }
  }
  return (
    <Paper p={{ base: "md", sm: "xl" }}>
      <Stack gap="lg">
        <Title order={3} size="h4">
          商店图片资源
        </Title>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          {graphicTypes.map((type) => (
            <Stack key={type} gap="xs">
              <Text fw={550}>{graphicLabels[type]}</Text>
              {draft.graphics?.[type] && (
                <img
                  src={draft.graphics[type]}
                  alt={graphicLabels[type]}
                  style={{
                    maxWidth: "100%",
                    maxHeight: 140,
                    objectFit: "contain",
                    alignSelf: "start",
                  }}
                />
              )}
              <Group gap="xs">
                <FileButton
                  accept="image/png,image/jpeg"
                  onChange={(file) => void upload(type, file)}
                >
                  {(props) => (
                    <Button
                      {...props}
                      size="xs"
                      variant="light"
                      loading={uploading === type}
                      disabled={!enabled || uploading !== null}
                    >
                      {draft.graphics?.[type] ? "替换" : "上传"}
                    </Button>
                  )}
                </FileButton>
                {draft.graphics?.[type] && (
                  <Button
                    size="xs"
                    variant="subtle"
                    disabled={!enabled || uploading !== null}
                    onClick={() => setGraphic(type)}
                  >
                    移除
                  </Button>
                )}
              </Group>
            </Stack>
          ))}
        </SimpleGrid>
      </Stack>
    </Paper>
  );
}
