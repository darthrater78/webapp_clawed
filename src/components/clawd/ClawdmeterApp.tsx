import { FullPageLayout } from "@/components/clawd/layouts/FullPageLayout";
import { SidePanelLayout } from "@/components/clawd/layouts/SidePanelLayout";
import {
  WidgetExpanded,
  WidgetLandscape,
  WidgetPortrait,
  WidgetXL,
} from "@/components/clawd/layouts/WidgetLayouts";
import { useClawdmeter } from "@/hooks/useClawdmeter";
import { usePlatform } from "@/hooks/usePlatform";

export function ClawdmeterApp() {
  const { platform } = usePlatform();
  const meter = useClawdmeter();

  switch (platform) {
    case "widget-landscape":
      return <WidgetLandscape meter={meter} />;
    case "widget-portrait":
      return <WidgetPortrait meter={meter} />;
    case "widget-expanded":
      return <WidgetExpanded meter={meter} />;
    case "widget-xl":
      return <WidgetXL meter={meter} />;
    case "sidepanel":
      return <SidePanelLayout meter={meter} />;
    default:
      return <FullPageLayout meter={meter} />;
  }
}
