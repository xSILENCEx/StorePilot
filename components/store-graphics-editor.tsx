"use client";
import { graphicDimensions } from "../lib/model";
import { ImagePreview } from "./image-preview";
import { hoverActionEvents } from "./hover-actions";
import { BatchDownload } from "./batch-download";
import { storeImage } from "../lib/store-image-client";
import { useState } from "react";
import {
  ActionIcon,
  UnstyledButton,
  Loader,
  FileButton,
  Paper,
  Group,
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
  appId,
  locale,
  draft,
  enabled,
  updateDraft,
}: {
  appId: string;
  locale: string;
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
      const url = await storeImage(file, {
        kind: "graphic",
        platform: "google",
        type,
      });
      updateDraft((current) => ({
        graphics: { ...current.graphics, [type]: url },
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
        <Group justify="space-between">
          <Title order={3} size="h4">
            商店图片资源
          </Title>
          <BatchDownload
            appId={appId}
            locale={locale}
            platform="google"
            group="商店图片资源"
            items={graphicTypes.flatMap((type) => {
              const url = draft.graphics?.[type];
              return url ? [{ url, label: graphicLabels[type] }] : [];
            })}
          />
        </Group>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          {graphicTypes.map((type) => {
            const url = draft.graphics?.[type];
            const label = graphicLabels[type];
            return (
              <Stack key={type} gap="xs">
                <Text fw={550}>
                  {label}{" "}
                  <Text component="span" size="xs" c="dimmed">
                    {graphicDimensions[type].join(" × ")} px
                  </Text>
                </Text>
                <div className="graphic-slot" {...hoverActionEvents}>
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
      <ImagePreview
        src={preview?.url}
        downloadName={preview?.label}
        alt={preview?.label ?? ""}
        title={`${preview?.label ?? ""}预览`}
        onClose={() => setPreview(null)}
      />
    </Paper>
  );
}
