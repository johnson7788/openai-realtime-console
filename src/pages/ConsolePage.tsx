/**
 * Running a local relay server will allow you to hide your API key
 * and run custom logic on the server
 *
 * Set the local relay server address to:
 * REACT_APP_LOCAL_RELAY_SERVER_URL=http://localhost:8081
 *
 * This will also require you to set OPENAI_API_KEY= in a `.env` file
 * You can run it with `npm run relay`, in parallel with `npm start`
 */
const LOCAL_RELAY_SERVER_URL: string =
  process.env.REACT_APP_LOCAL_RELAY_SERVER_URL || '';
console.log('LOCAL_RELAY_SERVER_URL', LOCAL_RELAY_SERVER_URL);

import { useEffect, useRef, useCallback, useState } from 'react';

import { RealtimeClient } from '@openai/realtime-api-beta';
import { ItemType } from '@openai/realtime-api-beta/dist/lib/client.js';
import { WavRecorder, WavStreamPlayer } from '../lib/wavtools/index.js';
import { instructions } from '../utils/conversation_config.js';
import { WavRenderer } from '../utils/wav_renderer';

import { X, Edit, Zap, ArrowUp, ArrowDown } from 'react-feather';
import { Button } from '../components/button/Button';
import { Toggle } from '../components/toggle/Toggle';
import { Map } from '../components/Map';

import './ConsolePage.scss';
import { isJsxOpeningLikeElement } from 'typescript';

/**
 * Type for result from get_weather() function call，工具函数，用于获取天气信息
 */
interface Coordinates {
  lat: number;
  lng: number;
  location?: string;
  temperature?: {
    value: number;
    units: string;
  };
  wind_speed?: {
    value: number;
    units: string;
  };
}

/**
 * Type for all event logs，日志类型
 */
interface RealtimeEvent {
  time: string;
  source: 'client' | 'server';
  count?: number;
  event: { [key: string]: any };
}

export function ConsolePage() {
  /**
   * Ask user for API Key，首先，组件会检查是否设置了本地中继服务器 URL。如果没有设置，
   * 它会从本地存储或用户输入中获取 OpenAI API Key，并将其存储在本地存储中。
   * If we're using the local relay server, we don't need this
   */
  const apiKey = LOCAL_RELAY_SERVER_URL
    ? ''
    : localStorage.getItem('tmp::voice_api_key') ||
      prompt('OpenAI API Key') ||
      '';
  if (apiKey !== '') {
    localStorage.setItem('tmp::voice_api_key', apiKey);
  }

  /**
   * Instantiate:
   * - WavRecorder (speech input)
   * - WavStreamPlayer (speech output)
   * - RealtimeClient (API client)
   * 音频录制和播放的初始化：组件初始化了两个音频工具，WavRecorder 和 WavStreamPlayer，分别用于音频录制和播放。
   */
  const wavRecorderRef = useRef<WavRecorder>(
    new WavRecorder({ sampleRate: 24000 })
  );
  const wavStreamPlayerRef = useRef<WavStreamPlayer>(
    new WavStreamPlayer({ sampleRate: 24000 })
  );
  //实时客户端的初始化：组件初始化了一个 RealtimeClient 实例，用于与 OpenAI 的实时 API 进行通信。
  const clientRef = useRef<RealtimeClient>(
    new RealtimeClient(
      LOCAL_RELAY_SERVER_URL
        ? { url: LOCAL_RELAY_SERVER_URL }
        : {
            apiKey: apiKey,
            dangerouslyAllowAPIKeyInBrowser: true,
          }
    )
  );

  /**
   * References for
   * - Rendering audio visualization (canvas)
   * - Autoscrolling event logs
   * - Timing delta for event log displays
   */
  const clientCanvasRef = useRef<HTMLCanvasElement>(null);
  const serverCanvasRef = useRef<HTMLCanvasElement>(null);
  const eventsScrollHeightRef = useRef(0); //用于存储滚动容器（<div>元素）的滚动高度。
  const eventsScrollRef = useRef<HTMLDivElement>(null);
  const startTimeRef = useRef<string>(new Date().toISOString());

  /**
   * All of our variables for displaying application state
   * - items are all conversation items (dialog)
   * - realtimeEvents are event logs, which can be expanded
   * - memoryKv is for set_memory() function
   * - coords, marker are for get_weather() function
   * 定义了一些React组件的状态变量，用于管理应用程序的状态。这些状态变量通过React的useState钩子来定义，每个状态变量都有一个初始值和一个更新函数。
   */
  const [items, setItems] = useState<ItemType[]>([]); //这是一个数组，用于存储所有的对话项（对话内容）。ItemType是这些对话项的类型定义。通过setItems函数可以更新这个数组。
  const [realtimeEvents, setRealtimeEvents] = useState<RealtimeEvent[]>([]); //这是一个数组，用于存储所有的实时事件日志。RealtimeEvent是这些日志项的类型定义。通过setRealtimeEvents函数可以更新这个数组。
  const [expandedEvents, setExpandedEvents] = useState<{
    [key: string]: boolean;
  }>({}); //这是一个对象，用于存储哪些实时事件日志被展开。通过setExpandedEvents函数可以更新这个对象。
  const [isConnected, setIsConnected] = useState(false); //这是一个布尔值，表示客户端是否已经连接到服务器。通过setIsConnected函数可以更新这个值。
  const [canPushToTalk, setCanPushToTalk] = useState(true); //这是一个布尔值，表示是否可以按下推到说话按钮。通过setCanPushToTalk函数可以更新这个值。
  const [isRecording, setIsRecording] = useState(false); //这是一个布尔值，表示是否正在录制音频。通过setIsRecording函数可以更新这个值。
  const [memoryKv, setMemoryKv] = useState<{ [key: string]: any }>({}); //这是一个对象，用于存储记忆键值对。通过setMemoryKv函数可以更新这个对象。
  const [coords, setCoords] = useState<Coordinates | null>({
    lat: 37.775593,
    lng: -122.418137,
  }); //这是一个Coordinates类型的对象，用于存储坐标。通过setCoords函数可以更新这个对象。用于攻击函数
  const [marker, setMarker] = useState<Coordinates | null>(null); //这是一个Coordinates类型的对象，用于存储标记坐标。通过setMarker函数可以更新这个对象。用于攻击函数

  /**
   * Utility for formatting the timing of logs
   * 格式化日志的时间戳
   */
  const formatTime = useCallback((timestamp: string) => {
    const startTime = startTimeRef.current;
    const t0 = new Date(startTime).valueOf();
    const t1 = new Date(timestamp).valueOf();
    const delta = t1 - t0;
    const hs = Math.floor(delta / 10) % 100;
    const s = Math.floor(delta / 1000) % 60;
    const m = Math.floor(delta / 60_000) % 60;
    const pad = (n: number) => {
      let s = n + '';
      while (s.length < 2) {
        s = '0' + s;
      }
      return s;
    };
    return `${pad(m)}:${pad(s)}.${pad(hs)}`;
  }, []);

  /**
   * When you click the API key
   * 点击API密钥时,会弹出一个提示框，要求输入新的API密钥。如果输入了新的API密钥，会清除本地存储，
   * 并将新的API密钥保存到本地存储中，然后重新加载页面。
   */
  const resetAPIKey = useCallback(() => {
    const apiKey = prompt('OpenAI API Key');
    if (apiKey !== null) {
      localStorage.clear();
      localStorage.setItem('tmp::voice_api_key', apiKey);
      window.location.reload();
    }
  }, []);

  /**
   * Connect to conversation:
   * WavRecorder taks speech input, WavStreamPlayer output, client is API client
   * 连接到对话:，WavRecorder负责语音输入，WavStreamPlayer负责输出，client是API客户端
   * 该函数使用useCallback钩子进行优化，确保在依赖项不变的情况下不会重新创建函数。这个函数的主要目的是连接到语音对话系统，包括麦克风、音频输出和实时API。下面是对代码的详细解释：
   */
  const connectConversation = useCallback(async () => {
    //获取引用：首先，通过clientRef、wavRecorderRef和wavStreamPlayerRef获取当前客户端、录音器和音频播放器的引用。
    const client = clientRef.current;
    const wavRecorder = wavRecorderRef.current;
    const wavStreamPlayer = wavStreamPlayerRef.current;

    // Set state variables，设置状态变量, 设置状态变量：使用startTimeRef记录当前时间，setIsConnected设置连接状态为true，setRealtimeEvents清空实时事件数组，setItems设置对话项。
    startTimeRef.current = new Date().toISOString();
    setIsConnected(true);
    setRealtimeEvents([]);
    setItems(client.conversation.getItems());

    // Connect to microphone,连接麦克风：调用wavRecorder.begin()开始录音
    await wavRecorder.begin();

    // Connect to audio output,连接音频输出：调用wavStreamPlayer.connect()连接音频输出。
    await wavStreamPlayer.connect();

    // Connect to realtime API, 连接实时API：尝试调用client.connect()连接到实时API。如果连接失败，捕获错误并打印到控制台。
    try {
      await client.connect();
    } catch (error) {
      console.error("WebSocket connection failed:", error);
    }
    //通过client.sendUserMessageContent发送一条用户消息，内容为Hello!。
    client.sendUserMessageContent([
      {
        type: `input_text`,
        text: `Hello!`,
        // text: `For testing purposes, I want you to list ten car brands. Number each item, e.g. "one (or whatever number you are one): the item name".`
      },
    ]);
    //如果客户端的语音检测类型为server_vad，则开始记录音频，并将音频数据发送到客户端。
    if (client.getTurnDetectionType() === 'server_vad') {
      await wavRecorder.record((data) => client.appendInputAudio(data.mono));
    }
  }, []);

  /**
   * Disconnect and reset conversation state
   * 用于断开对话连接和删除对话中的项目
   */
  const disconnectConversation = useCallback(async () => {
    setIsConnected(false);
    setRealtimeEvents([]);
    setItems([]);
    setMemoryKv({});
    setCoords({
      lat: 37.775593,
      lng: -122.418137,
    });
    setMarker(null);

    const client = clientRef.current;
    client.disconnect();

    const wavRecorder = wavRecorderRef.current;
    await wavRecorder.end();

    const wavStreamPlayer = wavStreamPlayerRef.current;
    await wavStreamPlayer.interrupt();
  }, []);

  //这个函数用于删除对话中的特定项目。它通过调用客户端实例的deleteItem方法来实现。
  const deleteConversationItem = useCallback(async (id: string) => {
    const client = clientRef.current;
    client.deleteItem(id);
  }, []);

  /**
   * In push-to-talk mode, start recording
   * .appendInputAudio() for each sample
   */
  const startRecording = async () => {
    setIsRecording(true);  //设置录音状态：调用setIsRecording(true)将录音状态设置为true
    const client = clientRef.current;
    const wavRecorder = wavRecorderRef.current;
    const wavStreamPlayer = wavStreamPlayerRef.current;
    const trackSampleOffset = await wavStreamPlayer.interrupt(); //中断音频播放：调用wavStreamPlayer.interrupt()中断当前的音频播放，并获取中断后的采样偏移量trackSampleOffset。
    if (trackSampleOffset?.trackId) { //取消响应：如果trackSampleOffset存在且包含trackId，则调用client.cancelResponse(trackId, offset)取消之前的响应。
      const { trackId, offset } = trackSampleOffset;
      await client.cancelResponse(trackId, offset);
    }
    //开始录音：调用wavRecorder.record方法开始录音，并在录音时将每个采样数据传递给client.appendInputAudio(data.mono)进行处理
    await wavRecorder.record((data) => client.appendInputAudio(data.mono));
  };

  /**
   * In push-to-talk mode, stop recording
   * 在“按住说话”模式下，停止录音。
   */
  const stopRecording = async () => {
    setIsRecording(false);
    const client = clientRef.current;
    const wavRecorder = wavRecorderRef.current;
    await wavRecorder.pause();
    client.createResponse();
  };

  /**
   * Switch between Manual <> VAD mode for communication
   * 用于在手动模式和语音活动检测（VAD）模式之间切换通信方式。
   */
  const changeTurnEndType = async (value: string) => {
    const client = clientRef.current; //函数首先通过clientRef.current和wavRecorderRef.current获取当前客户端和音频录制器的引用。
    const wavRecorder = wavRecorderRef.current;
    if (value === 'none' && wavRecorder.getStatus() === 'recording') {
      await wavRecorder.pause();
    } //暂停录制：如果切换到'none'模式且音频录制器正在录制，则调用wavRecorder.pause()暂停录制。
    client.updateSession({
      turn_detection: value === 'none' ? null : { type: 'server_vad' },
    });
    //更新会话：使用client.updateSession方法更新会话配置。如果value是'none'，则将turn_detection设置为null，否则设置为{ type: 'server_vad' }。
    if (value === 'server_vad' && client.isConnected()) {
      await wavRecorder.record((data) => client.appendInputAudio(data.mono));
    }
    //开始录制：如果切换到'server_vad'模式且客户端已连接，则调用wavRecorder.record开始录制音频，并将录制的数据通过client.appendInputAudio方法发送到客户端。
    setCanPushToTalk(value === 'none');
    //更新推送状态：最后，使用setCanPushToTalk函数更新是否可以推送讲话的状态，如果value是'none'，则设置为true，否则设置为false。
  };

  /**
   * Auto-scroll the event logs
   * 使用了React的useEffect钩子来实现在事件日志自动滚动功能。
   */
  useEffect(() => {
    if (eventsScrollRef.current) {
      const eventsEl = eventsScrollRef.current;
      const scrollHeight = eventsEl.scrollHeight;
      // Only scroll if height has just changed, 如果事件日志的高度发生了变化（即新的日志被添加），则将滚动条自动滚动到底部。
      if (scrollHeight !== eventsScrollHeightRef.current) {
        eventsEl.scrollTop = scrollHeight;
        eventsScrollHeightRef.current = scrollHeight;
      }
    }
  }, [realtimeEvents]);

  /**
   * Auto-scroll the conversation logs
   * useEffect的第二个参数是一个依赖项数组[items]。这意味着这个useEffect会在items发生变化时执行。items通常是一个状态变量，代表聊天记录列表。
   */
  useEffect(() => {
    const conversationEls = [].slice.call(
      document.body.querySelectorAll('[data-conversation-content]')
    );
    //滚动到最新消息：遍历这些元素，将每个元素的scrollTop属性设置为scrollHeight，这样就会自动滚动到元素的底部，即最新的聊天记录。
    for (const el of conversationEls) {
      const conversationEl = el as HTMLDivElement;
      conversationEl.scrollTop = conversationEl.scrollHeight;
    }
  }, [items]);

  /**
   * Set up render loops for the visualization canvas
   * 用于设置可视化画布的渲染循环。它主要用于处理和显示音频数据，通过绘制条形图来展示音频频率
   */
  useEffect(() => {
    let isLoaded = true;

    const wavRecorder = wavRecorderRef.current;
    const clientCanvas = clientCanvasRef.current;
    let clientCtx: CanvasRenderingContext2D | null = null;

    const wavStreamPlayer = wavStreamPlayerRef.current;
    const serverCanvas = serverCanvasRef.current;
    let serverCtx: CanvasRenderingContext2D | null = null;

    const render = () => {
      if (isLoaded) {
        //如果clientCanvas存在且宽高未设置，则根据offsetWidth和offsetHeight设置宽高。
        if (clientCanvas) {
          if (!clientCanvas.width || !clientCanvas.height) {
            clientCanvas.width = clientCanvas.offsetWidth;
            clientCanvas.height = clientCanvas.offsetHeight;
          }
          //获取clientCanvas的2D渲染上下文clientCtx，并清空画布。
          clientCtx = clientCtx || clientCanvas.getContext('2d');
          if (clientCtx) {
            clientCtx.clearRect(0, 0, clientCanvas.width, clientCanvas.height);
            //调用wavRecorder.getFrequencies('voice')获取音频频率数据，并使用WavRenderer.drawBars绘制条形图。
            const result = wavRecorder.recording
              ? wavRecorder.getFrequencies('voice')
              : { values: new Float32Array([0]) };
            //对serverCanvas进行类似的处理，但使用wavStreamPlayer.getFrequencies('voice')获取音频频率数据。
            WavRenderer.drawBars(
              clientCanvas,
              clientCtx,
              result.values,
              '#0099ff',
              10,
              0,
              8
            );
          }
        }
        if (serverCanvas) {
          if (!serverCanvas.width || !serverCanvas.height) {
            serverCanvas.width = serverCanvas.offsetWidth;
            serverCanvas.height = serverCanvas.offsetHeight;
          }
          serverCtx = serverCtx || serverCanvas.getContext('2d');
          if (serverCtx) {
            serverCtx.clearRect(0, 0, serverCanvas.width, serverCanvas.height);
            const result = wavStreamPlayer.analyser
              ? wavStreamPlayer.getFrequencies('voice')
              : { values: new Float32Array([0]) };
            WavRenderer.drawBars(
              serverCanvas,
              serverCtx,
              result.values,
              '#009900',
              10,
              0,
              8
            );
          }
        }
        window.requestAnimationFrame(render);
      }
    };
    render();

    return () => {
      isLoaded = false;
    };
  }, []);

  /**
   * Core RealtimeClient and audio capture setup
   * Set all of our instructions, tools, events and more
   * useEffect钩子来设置实时客户端和音频捕获的配置。它包括了一系列的初始化步骤，如设置会话、添加工具、处理实时事件等
   */
  useEffect(() => {
    // Get refs
    const wavStreamPlayer = wavStreamPlayerRef.current;
    const client = clientRef.current;

    // Set instructions, 通过updateSession方法更新会话的指令和音频转录模型
    client.updateSession({ instructions: instructions });
    // Set transcription, otherwise we don't get user transcriptions back
    client.updateSession({ input_audio_transcription: { model: 'whisper-1' } });

    // Add tools, 添加工具，这些工具可以在实时客户端中使用,添加了一个名为set_memory的工具，用于将用户的重要数据保存到内存中。工具的参数包括key和value，它们分别代表内存值的键和值。
    client.addTool(
      {
        name: 'set_memory',
        description: 'Saves important data about the user into memory.',
        parameters: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description:
                'The key of the memory value. Always use lowercase and underscores, no other characters.',
            },
            value: {
              type: 'string',
              description: 'Value can be anything represented as a string',
            },
          },
          required: ['key', 'value'],
        },
      },
      async ({ key, value }: { [key: string]: any }) => {
        setMemoryKv((memoryKv) => {
          const newKv = { ...memoryKv };
          newKv[key] = value;
          return newKv;
        });
        return { ok: true };
      }
    );
    //添加了一个名为get_weather的工具，用于获取给定经纬度坐标对的位置的天气信息。工具的参数包括lat（纬度）、lng（经度）和location（位置名称）。
    client.addTool(
      {
        name: 'get_weather',
        description:
          'Retrieves the weather for a given lat, lng coordinate pair. Specify a label for the location.',
        parameters: {
          type: 'object',
          properties: {
            lat: {
              type: 'number',
              description: 'Latitude',
            },
            lng: {
              type: 'number',
              description: 'Longitude',
            },
            location: {
              type: 'string',
              description: 'Name of the location',
            },
          },
          required: ['lat', 'lng', 'location'],
        },
      },
      async ({ lat, lng, location }: { [key: string]: any }) => {
        setMarker({ lat, lng, location });
        setCoords({ lat, lng, location });
        const result = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,wind_speed_10m`
        );
        const json = await result.json();
        const temperature = {
          value: json.current.temperature_2m as number,
          units: json.current_units.temperature_2m as string,
        };
        const wind_speed = {
          value: json.current.wind_speed_10m as number,
          units: json.current_units.wind_speed_10m as string,
        };
        setMarker({ lat, lng, location, temperature, wind_speed });
        return json;
      }
    );
    //这里监听realtime.event事件，并将事件信息保存到状态中。如果连续收到相同类型的事件，则将它们聚合在一起。
    // handle realtime events from client + server for event logging
    client.on('realtime.event', (realtimeEvent: RealtimeEvent) => {
      setRealtimeEvents((realtimeEvents) => {
        const lastEvent = realtimeEvents[realtimeEvents.length - 1];
        if (lastEvent?.event.type === realtimeEvent.event.type) {
          // if we receive multiple events in a row, aggregate them for display purposes
          lastEvent.count = (lastEvent.count || 0) + 1;
          return realtimeEvents.slice(0, -1).concat(lastEvent);
        } else {
          return realtimeEvents.concat(realtimeEvent);
        }
      });
    });
    //错误处理和会话中断处理,这里监听error事件，并在控制台输出错误信息。同时，监听conversation.interrupted事件，在会话中断时取消响应
    client.on('error', (event: any) => console.error(event));
    client.on('conversation.interrupted', async () => {
      const trackSampleOffset = await wavStreamPlayer.interrupt();
      if (trackSampleOffset?.trackId) {
        const { trackId, offset } = trackSampleOffset;
        await client.cancelResponse(trackId, offset);
      }
    });
    //会话更新处理，这里监听conversation.updated事件，并在会话更新时更新items状态。
    //如果收到音频数据，则将其添加到wavStreamPlayer中。如果会话完成并且有音频数据，则将其解码并保存到item.formatted.file中。
    client.on('conversation.updated', async ({ item, delta }: any) => {
      const items = client.conversation.getItems();
      if (delta?.audio) {
        wavStreamPlayer.add16BitPCM(delta.audio, item.id);
      }
      if (item.status === 'completed' && item.formatted.audio?.length) {
        const wavFile = await WavRecorder.decode(
          item.formatted.audio,
          24000,
          24000
        );
        item.formatted.file = wavFile;
      }
      setItems(items);
    });

    setItems(client.conversation.getItems());
    //在组件卸载时，重置客户端。
    return () => {
      // cleanup; resets to defaults
      client.reset();
    };
  }, []);

  /**
   * Render the application
   * 这段TypeScript代码定义了一个React组件，用于渲染一个实时控制台页面。这个页面包含多个部分，
   * 包括API密钥管理、实时事件日志、对话记录、操作按钮以及地图和内存键值对显示。下面是对代码各部分的详细解释：
   */
  return (
    <div data-component="ConsolePage">
      <div className="content-top">
        <div className="content-title">
          <img src="/openai-logomark.svg" />
          <span>realtime console</span>
        </div>
        <div className="content-api-key">
          {!LOCAL_RELAY_SERVER_URL && (
            <Button
              icon={Edit}
              iconPosition="end"
              buttonStyle="flush"
              label={`api key: ${apiKey.slice(0, 3)}...`}
              onClick={() => resetAPIKey()}
            />
          )}
        </div>
      </div>
      <div className="content-main">
        {/* 左侧内容：<div className="content-logs"> 包含实时事件日志和对话记录。 */}
        <div className="content-logs">
          <div className="content-block events">
            <div className="visualization">
              <div className="visualization-entry client">
                <canvas ref={clientCanvasRef} />
              </div>
              <div className="visualization-entry server">
                <canvas ref={serverCanvasRef} />
              </div>
            </div>
            <div className="content-block-title">events</div>
            <div className="content-block-body" ref={eventsScrollRef}>
              {!realtimeEvents.length && `awaiting connection...`}
              {realtimeEvents.map((realtimeEvent, i) => {
                const count = realtimeEvent.count;
                const event = { ...realtimeEvent.event };
                if (event.type === 'input_audio_buffer.append') {
                  event.audio = `[trimmed: ${event.audio.length} bytes]`;
                } else if (event.type === 'response.audio.delta') {
                  event.delta = `[trimmed: ${event.delta.length} bytes]`;
                }
                return (
                  <div className="event" key={event.event_id}>
                    <div className="event-timestamp">
                      {formatTime(realtimeEvent.time)}
                    </div>
                    <div className="event-details">
                      <div
                        className="event-summary"
                        onClick={() => {
                          // toggle event details
                          const id = event.event_id;
                          const expanded = { ...expandedEvents };
                          if (expanded[id]) {
                            delete expanded[id];
                          } else {
                            expanded[id] = true;
                          }
                          setExpandedEvents(expanded);
                        }}
                      >
                        <div
                          className={`event-source ${
                            event.type === 'error'
                              ? 'error'
                              : realtimeEvent.source
                          }`}
                        >
                          {realtimeEvent.source === 'client' ? (
                            <ArrowUp />
                          ) : (
                            <ArrowDown />
                          )}
                          <span>
                            {event.type === 'error'
                              ? 'error!'
                              : realtimeEvent.source}
                          </span>
                        </div>
                        <div className="event-type">
                          {event.type}
                          {count && ` (${count})`}
                        </div>
                      </div>
                      {!!expandedEvents[event.event_id] && (
                        <div className="event-payload">
                          {JSON.stringify(event, null, 2)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="content-block conversation">
            <div className="content-block-title">conversation</div>
            <div className="content-block-body" data-conversation-content>
              {!items.length && `awaiting connection...`}
              {items.map((conversationItem, i) => {
                return (
                  <div className="conversation-item" key={conversationItem.id}>
                    <div className={`speaker ${conversationItem.role || ''}`}>
                      <div>
                        {(
                          conversationItem.role || conversationItem.type
                        ).replaceAll('_', ' ')}
                      </div>
                      <div
                        className="close"
                        onClick={() =>
                          deleteConversationItem(conversationItem.id)
                        }
                      >
                        <X />
                      </div>
                    </div>
                    <div className={`speaker-content`}>
                      {/* tool response */}
                      {conversationItem.type === 'function_call_output' && (
                        <div>{conversationItem.formatted.output}</div>
                      )}
                      {/* tool call */}
                      {!!conversationItem.formatted.tool && (
                        <div>
                          {conversationItem.formatted.tool.name}(
                          {conversationItem.formatted.tool.arguments})
                        </div>
                      )}
                      {!conversationItem.formatted.tool &&
                        conversationItem.role === 'user' && (
                          <div>
                            {conversationItem.formatted.transcript ||
                              (conversationItem.formatted.audio?.length
                                ? '(awaiting transcript)'
                                : conversationItem.formatted.text ||
                                  '(item sent)')}
                          </div>
                        )}
                      {!conversationItem.formatted.tool &&
                        conversationItem.role === 'assistant' && (
                          <div>
                            {conversationItem.formatted.transcript ||
                              conversationItem.formatted.text ||
                              '(truncated)'}
                          </div>
                        )}
                      {conversationItem.formatted.file && (
                        <audio
                          src={conversationItem.formatted.file.url}
                          controls
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="content-actions">
            <Toggle
              defaultValue={false}
              labels={['manual', 'vad']}
              values={['none', 'server_vad']}
              onChange={(_, value) => changeTurnEndType(value)}
            />
            <div className="spacer" />
            {isConnected && canPushToTalk && (
              <Button
                label={isRecording ? 'release to send' : 'push to talk'}
                buttonStyle={isRecording ? 'alert' : 'regular'}
                disabled={!isConnected || !canPushToTalk}
                onMouseDown={startRecording}
                onMouseUp={stopRecording}
              />
            )}
            <div className="spacer" />
            <Button
              label={isConnected ? 'disconnect' : 'connect'}
              iconPosition={isConnected ? 'end' : 'start'}
              icon={isConnected ? X : Zap}
              buttonStyle={isConnected ? 'regular' : 'action'}
              onClick={
                isConnected ? disconnectConversation : connectConversation
              }
            />
          </div>
        </div>
        {/* 右侧内容：<div className="content-right"> 包含地图和内存键值对显示。 */}
        <div className="content-right">
          <div className="content-block map">
            <div className="content-block-title">get_weather()</div>
            <div className="content-block-title bottom">
              {marker?.location || 'not yet retrieved'}
              {!!marker?.temperature && (
                <>
                  <br />
                  🌡️ {marker.temperature.value} {marker.temperature.units}
                </>
              )}
              {!!marker?.wind_speed && (
                <>
                  {' '}
                  🍃 {marker.wind_speed.value} {marker.wind_speed.units}
                </>
              )}
            </div>
            <div className="content-block-body full">
              {coords && (
                <Map
                  center={[coords.lat, coords.lng]}
                  location={coords.location}
                />
              )}
            </div>
          </div>
          <div className="content-block kv">
            <div className="content-block-title">set_memory()</div>
            <div className="content-block-body content-kv">
              {JSON.stringify(memoryKv, null, 2)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
