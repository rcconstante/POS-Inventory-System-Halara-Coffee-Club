import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BRIDGE_VERSION, POS_ORIGIN, isTrustedPosUrl, parseNativeRequest, type NativeRequest, type NativeResponse } from '../../../../shared/native-protocol';
import { choosePrinter, printReceipt } from '../../lib/printer';

const nativeReady = `window.HalaraNative={version:${BRIDGE_VERSION}};true;`;
const startUrl = `${POS_ORIGIN}/?halaraApp=staff#/login/staff`;

export default function PosScreen() {
  const web = useRef<WebView>(null);
  const canGoBack = useRef(false);
  const trustedPage = useRef(true);
  const activeRequests = useRef(new Set<string>());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack.current) { web.current?.goBack(); return true; }
      return false;
    });
    return () => listener.remove();
  }, []);

  const onMessage = useCallback(async (event: WebViewMessageEvent) => {
    if (!trustedPage.current || !isTrustedPosUrl(event.nativeEvent.url)) return;
    let request: NativeRequest;
    try { request = parseNativeRequest(event.nativeEvent.data); } catch { return; }
    if (activeRequests.current.has(request.id)) return;
    activeRequests.current.add(request.id);
    let response: NativeResponse;
    try {
      const message = request.action === 'print' ? await printReceipt(request.receipt) : await choosePrinter();
      response = { version: 1, id: request.id, success: true, message };
    } catch (error) {
      response = { version: 1, id: request.id, success: false, message: error instanceof Error ? error.message : 'The printer request failed.' };
    } finally { activeRequests.current.delete(request.id); }
    if (!trustedPage.current) return;
    const json = JSON.stringify(response).replace(/</g, '\\u003c');
    web.current?.injectJavaScript(`window.dispatchEvent(new CustomEvent('halara-native-response',{detail:${json}}));true;`);
  }, []);

  const connectionError = useCallback(() => {
    setLoading(false);
    Alert.alert('Cannot open the POS', 'Check the tablet’s internet connection, then reload. Sales and inventory require a connection.', [
      { text: 'Reload', onPress: () => { setLoading(true); web.current?.reload(); } },
    ]);
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
      <WebView
        ref={web}
        source={{ uri: startUrl }}
        style={styles.web}
        injectedJavaScriptBeforeContentLoaded={nativeReady}
        injectedJavaScript={nativeReady}
        onMessage={(event) => { void onMessage(event); }}
        onShouldStartLoadWithRequest={(request) => {
          if (request.url === 'about:blank') return true;
          return isTrustedPosUrl(request.url) && !new URL(request.url).hash.startsWith('#/admin');
        }}
        onNavigationStateChange={(state) => { canGoBack.current = state.canGoBack; trustedPage.current = isTrustedPosUrl(state.url); }}
        onLoadStart={() => { setLoading(true); }}
        onLoadEnd={() => { setLoading(false); }}
        onError={connectionError}
        onHttpError={(event) => {
          const { url, statusCode } = event.nativeEvent;
          if (statusCode >= 400 && isTrustedPosUrl(url) && new URL(url).pathname === '/') connectionError();
        }}
        onRenderProcessGone={() => { connectionError(); }}
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={[POS_ORIGIN]}
        mixedContentMode="never"
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        geolocationEnabled={false}
        javaScriptCanOpenWindowsAutomatically={false}
        setSupportMultipleWindows={false}
        webviewDebuggingEnabled={__DEV__}
      />
      {loading && <View style={styles.loading} pointerEvents="none"><ActivityIndicator size="large" color="#6f2f0d" accessibilityLabel="Opening staff POS" /></View>}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f2ef' },
  web: { flex: 1, backgroundColor: '#f5f2ef' },
  loading: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f2ef' },
});
