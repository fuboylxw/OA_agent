import { Injectable } from '@nestjs/common';

interface FlowInfo {
  processCode: string;
  processName: string;
  processCategory: string;
}

interface FlowMatchResult {
  matchedFlow?: {
    processCode: string;
    processName: string;
    confidence: number;
  };
  needsClarification: boolean;
  clarificationQuestion?: string;
}

@Injectable()
export class FlowAgent {
  async matchFlow(
    intent: string,
    message: string,
    availableFlows: FlowInfo[],
  ): Promise<FlowMatchResult> {
    if (availableFlows.length === 0) {
      return {
        needsClarification: true,
        clarificationQuestion: '当前没有可用的流程模板，请先通过初始化中心导入OA系统。',
      };
    }

    // Score each flow based on keyword matching
    const scored = availableFlows.map(flow => {
      let score = 0;
      const lowerMessage = message.toLowerCase();
      const lowerName = flow.processName.toLowerCase();
      const lowerCode = flow.processCode.toLowerCase();

      // Exact name match
      if (lowerMessage.includes(lowerName)) {
        score += 1.0;
      }

      // Code match
      if (lowerMessage.includes(lowerCode)) {
        score += 0.8;
      }

      // Word-level substring matching (split name into meaningful segments)
      const nameSegments = lowerName.split(/[\s_\-\/]+/).filter(s => s.length >= 2);
      let matchedSegments = 0;
      for (const segment of nameSegments) {
        if (lowerMessage.includes(segment)) {
          matchedSegments++;
        }
      }
      if (nameSegments.length > 0) {
        score += (matchedSegments / nameSegments.length) * 0.5;
      }

      // Category matching
      if (flow.processCategory && lowerMessage.includes(flow.processCategory.toLowerCase())) {
        score += 0.3;
      }

      // Common keyword associations
      const associations: Record<string, string[]> = {
        travel_expense: ['差旅', '报销', '出差', '机票', '酒店', '交通'],
        leave_request: ['请假', '休假', '年假', '病假', '事假'],
        purchase_request: ['采购', '购买', '物品', '设备'],
        meeting_room: ['会议室', '预约', '会议', '开会'],
        business_trip: ['出差', '差旅', '外出'],
      };

      const keywords = associations[flow.processCode] || [];
      for (const keyword of keywords) {
        if (message.includes(keyword)) {
          score += 0.6;
          break;
        }
      }

      return { flow, score };
    });

    // Sort by score
    scored.sort((a, b) => b.score - a.score);

    const best = scored[0];

    // If confidence is too low, ask for clarification
    if (best.score < 0.3) {
      const suggestions = scored.slice(0, 3).map(s => s.flow.processName);
      return {
        needsClarification: true,
        clarificationQuestion: `我不太确定您想办理哪个流程。您是想办理以下哪个？\n${suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
      };
    }

    // If top two are very close, ask for clarification
    if (scored.length > 1 && scored[1].score > best.score * 0.8) {
      return {
        needsClarification: true,
        clarificationQuestion: `您是想办理"${best.flow.processName}"还是"${scored[1].flow.processName}"？`,
      };
    }

    return {
      matchedFlow: {
        processCode: best.flow.processCode,
        processName: best.flow.processName,
        confidence: Math.min(best.score, 1.0),
      },
      needsClarification: false,
    };
  }
}
