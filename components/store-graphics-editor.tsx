"use client";
import { useState } from "react";
import {
  ActionIcon,
  UnstyledButton,
  Modal,
  Loader,
  FileButton,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { ImagePlus, Pencil } from "lucide-react";
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
  const [preview, setPreview] = useState<{ url: string; label: string } | null>(
    null,
  );
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
      updateDraft((current) => ({
        graphics: { ...current.graphics, [type]: result.url },
      }));
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
          {graphicTypes.map((type) => {
            const url = draft.graphics?.[type];
            const label = graphicLabels[type];
            return (
              <Stack key={type} gap="xs">
                <Text fw={550}>{label}</Text>
                <div className="graphic-slot">
                  {url && (
                    <UnstyledButton
                      className="graphic-preview"
                      aria-label={`预览${label}`}
                      onClick={() => setPreview({ url, label })}
                    >
                      <img src={url} alt={label} />
                    </UnstyledButton>
                  )}
                  <FileButton
                    accept="image/png,image/jpeg"
                    onChange={(file) => void upload(type, file)}
                  >
                    {(props) =>
                      url ? (
                        <ActionIcon
                          {...props}
                          className="graphic-edit"
                          variant="white"
                          color="dark"
                          size="md"
                          loading={uploading === type}
                          disabled={!enabled || uploading !== null}
                          aria-label={`替换${label}`}
                          title={`替换${label}`}
                        >
                          <Pencil size={15} />
                        </ActionIcon>
                      ) : (
                        <UnstyledButton
                          {...props}
                          className="graphic-add"
                          data-kind={type}
                          disabled={!enabled || uploading !== null}
                        >
                          {uploading === type ? (
                            <Loader size="sm" />
                          ) : (
                            <ImagePlus size={20} />
                          )}{" "}
                          添加{label}
                        </UnstyledButton>
                      )
                    }
                  </FileButton>
                </div>
              </Stack>
            );
          })}
        </SimpleGrid>
      </Stack>
      <Modal
        opened={!!preview}
        onClose={() => setPreview(null)}
        title={preview && `${preview.label}预览`}
        size="lg"
      >
        {preview && (
          <img
            className="image-preview"
            src={preview.url}
            alt={preview.label}
          />
        )}
      </Modal>
    </Paper>
  );
}
