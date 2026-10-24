package com.mailroom.company;
import android.app.Activity;
import android.os.Bundle;
import android.content.Intent;
import android.net.Uri;
import android.webkit.*;
import android.view.View;
import android.view.WindowInsets;
import android.os.Build;
import android.widget.*;
import android.graphics.Color;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.io.OutputStream;
import java.io.InputStream;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.net.URL;
import javax.net.ssl.HttpsURLConnection;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import java.security.KeyStore;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import org.json.JSONObject;
import java.util.HashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** First-party WebView. No ChatGPT identity, no browser-owned account required. */
public final class MainActivity extends Activity {
 private WebView web;private ProgressBar progress;private LinearLayout root;private ValueCallback<Uri[]> chooser;private byte[] pendingBytes;private String pendingName,pendingMime;
 private final ExecutorService network=Executors.newFixedThreadPool(4);
 private String origin(){return "https://mailroom.local";}
 private SecretKey sessionKey() throws Exception {KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);if(store.containsAlias("mailroom-session-v2"))return (SecretKey)store.getKey("mailroom-session-v2",null);KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");generator.init(new KeyGenParameterSpec.Builder("mailroom-session-v2",KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());return generator.generateKey();}
 private synchronized String session(){String saved=getSharedPreferences("mailroom",MODE_PRIVATE).getString("session","");if(saved.isEmpty())return "";try{String[] parts=saved.split(":");Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,sessionKey(),new GCMParameterSpec(128,Base64.decode(parts[0],Base64.NO_WRAP)));return new String(cipher.doFinal(Base64.decode(parts[1],Base64.NO_WRAP)),StandardCharsets.UTF_8);}catch(Exception e){getSharedPreferences("mailroom",MODE_PRIVATE).edit().remove("session").apply();return "";}}
 private synchronized void session(String value) throws Exception {if(value.isEmpty()){getSharedPreferences("mailroom",MODE_PRIVATE).edit().remove("session").commit();return;}Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,sessionKey());String saved=Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)+":"+Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP);if(!getSharedPreferences("mailroom",MODE_PRIVATE).edit().putString("session",saved).commit())throw new Exception("Session could not be stored");}
 private void answer(String id,int status,String body){runOnUiThread(()->{if(web!=null&&own(web.getUrl()))web.evaluateJavascript("window.__mailroomApiResolve("+JSONObject.quote(id)+","+status+","+JSONObject.quote(body)+")",null);});}
 public final class Api {@JavascriptInterface public void request(String id,String path,String method,String raw){if(id==null||id.length()>80||path==null||!path.matches("[a-z/-]{1,80}")||raw==null||raw.length()>2100000||!(method.equals("GET")||method.equals("POST")||method.equals("PUT")))return;runOnUiThread(()->{if(!own(web.getUrl()))return;network.execute(()->{HttpsURLConnection connection=null;try{JSONObject payload=new JSONObject();payload.put("path",path);payload.put("method",method);payload.put("body",new JSONObject(raw));payload.put("session",session());byte[] bytes=payload.toString().getBytes(StandardCharsets.UTF_8);connection=(HttpsURLConnection)new URL(BuildConfig.BACKEND_URL).openConnection();connection.setRequestMethod("POST");connection.setConnectTimeout(10000);connection.setReadTimeout(25000);connection.setInstanceFollowRedirects(false);connection.setDoOutput(true);connection.setRequestProperty("Content-Type","application/json");connection.setFixedLengthStreamingMode(bytes.length);try(OutputStream out=connection.getOutputStream()){out.write(bytes);}int status=connection.getResponseCode();InputStream in=status<400?connection.getInputStream():connection.getErrorStream();ByteArrayOutputStream buffer=new ByteArrayOutputStream();if(in!=null){try(InputStream stream=in){byte[] chunk=new byte[8192];int n;while((n=stream.read(chunk))!=-1){buffer.write(chunk,0,n);if(buffer.size()>2200000)throw new Exception("Response too large");}}}JSONObject response=new JSONObject(new String(buffer.toByteArray(),StandardCharsets.UTF_8));if(response.has("__session")){session(response.getString("__session"));response.remove("__session");}if(response.optBoolean("__clear",false)){session("");response.remove("__clear");}answer(id,status,response.toString());}catch(Exception e){answer(id,503,"{\"error\":\"Could not connect. Check your internet connection and retry.\"}");}finally{if(connection!=null)connection.disconnect();}});});}}
 private boolean own(String value){try{Uri u=Uri.parse(value),base=Uri.parse(origin());return "https".equals(u.getScheme())&&base.getHost().equals(u.getHost())&&(u.getPort()==-1||u.getPort()==443);}catch(Exception e){return false;}}
 @Override public void onCreate(Bundle state){super.onCreate(state);root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setBackgroundColor(Color.rgb(248,250,243));setContentView(root);
  if(Build.VERSION.SDK_INT>=30){root.setOnApplyWindowInsetsListener((v,insets)->{android.graphics.Insets s=insets.getInsets(WindowInsets.Type.systemBars());v.setPadding(s.left,s.top,s.right,s.bottom);return insets;});root.requestApplyInsets();}
  progress=new ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal);root.addView(progress,new LinearLayout.LayoutParams(-1,6));web=new WebView(this);root.addView(web,new LinearLayout.LayoutParams(-1,0,1));
  WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);settings.setAllowFileAccess(false);settings.setAllowContentAccess(true);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);settings.setJavaScriptCanOpenWindowsAutomatically(false);if(Build.VERSION.SDK_INT>=26)settings.setSafeBrowsingEnabled(true);
  CookieManager.getInstance().setAcceptCookie(true);CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
  web.addJavascriptInterface(new Files(),"MailroomFiles");
  web.addJavascriptInterface(new Api(),"MailroomApi");
  web.setWebChromeClient(new WebChromeClient(){@Override public void onProgressChanged(WebView v,int n){progress.setProgress(n);progress.setVisibility(n==100?View.GONE:View.VISIBLE);}@Override public boolean onShowFileChooser(WebView v,ValueCallback<Uri[]> callback,FileChooserParams params){if(chooser!=null)chooser.onReceiveValue(null);chooser=callback;Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType("*/*");i.putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"text/csv","text/comma-separated-values","application/csv","text/plain","application/vnd.ms-excel"});try{startActivityForResult(i,7);}catch(Exception e){chooser.onReceiveValue(null);chooser=null;Toast.makeText(MainActivity.this,"No file picker is available.",Toast.LENGTH_LONG).show();}return true;}});
  web.setWebViewClient(new WebViewClient(){
   @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){String url=request.getUrl().toString();if(!own(url))return null;String name=request.getUrl().getPath();if(name==null||name.equals("/"))name="/index.html";if(name.contains("..")||name.contains("\\"))return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));String type=name.endsWith(".js")?"text/javascript":name.endsWith(".css")?"text/css":name.endsWith(".svg")?"image/svg+xml":"text/html";try{HashMap<String,String> headers=new HashMap<>();headers.put("Cache-Control","no-store");headers.put("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' blob:; frame-src 'self' about:; object-src 'none'; base-uri 'self'");return new WebResourceResponse(type,"UTF-8",200,"OK",headers,getAssets().open("web"+name));}catch(Exception e){return new WebResourceResponse("text/plain","UTF-8",404,"Not Found",null,new ByteArrayInputStream(new byte[0]));}}
   @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){String url=r.getUrl().toString();if(own(url)||(!r.isForMainFrame()&&url.startsWith("about:")))return false;if("https".equals(r.getUrl().getScheme())||"mailto".equals(r.getUrl().getScheme()))try{startActivity(new Intent(Intent.ACTION_VIEW,r.getUrl()));}catch(Exception ignored){}return true;}
   @Override public void onPageFinished(WebView v,String url){if(!own(url))return;CookieManager.getInstance().flush();v.evaluateJavascript("(function(){if(window.__mailroomDownloads)return;window.__mailroomDownloads=true;const original=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download&&this.href.startsWith('blob:')){const name=this.download;fetch(this.href).then(r=>r.blob()).then(b=>{if(b.size>2000000){alert('Export must be smaller than 2 MB.');return;}const f=new FileReader();f.onload=()=>MailroomFiles.save(String(f.result).split(',')[1],name,b.type||'application/octet-stream');f.readAsDataURL(b);});return;}return original.call(this);};})();",null);}
   @Override public void onReceivedError(WebView v,WebResourceRequest r,WebResourceError e){if(r.isForMainFrame()){progress.setVisibility(View.GONE);new android.app.AlertDialog.Builder(MainActivity.this).setTitle("Unable to connect").setMessage("Check your internet connection and try again. Your company account is independent of ChatGPT.").setPositiveButton("Retry",(d,w)->web.loadUrl(origin())).setNegativeButton("Close",(d,w)->finish()).show();}}
  });
  if(state==null||web.restoreState(state)==null)web.loadUrl(origin());
 }
 public final class Files {@JavascriptInterface public void save(String data,String name,String mime){if(data==null||data.length()>2800000)return;runOnUiThread(()->{if(!own(web.getUrl()))return;try{byte[] bytes=Base64.decode(data,Base64.DEFAULT);if(bytes.length>2000000)return;pendingBytes=bytes;pendingName=name.replaceAll("[^A-Za-z0-9._-]","_");pendingMime=mime;Intent i=new Intent(Intent.ACTION_CREATE_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType(mime);i.putExtra(Intent.EXTRA_TITLE,pendingName);startActivityForResult(i,8);}catch(Exception e){pendingBytes=null;Toast.makeText(MainActivity.this,"Could not save this file.",Toast.LENGTH_LONG).show();}});}}
 @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request==7&&chooser!=null){chooser.onReceiveValue(result==RESULT_OK&&data!=null&&data.getData()!=null?new Uri[]{data.getData()}:null);chooser=null;}if(request==8&&pendingBytes!=null){byte[] bytes=pendingBytes;pendingBytes=null;if(result==RESULT_OK&&data!=null&&data.getData()!=null){try(OutputStream out=getContentResolver().openOutputStream(data.getData())){if(out==null)throw new Exception();out.write(bytes);Toast.makeText(this,"File saved.",Toast.LENGTH_SHORT).show();}catch(Exception e){Toast.makeText(this,"The file could not be saved.",Toast.LENGTH_LONG).show();}}}}
 @Override protected void onSaveInstanceState(Bundle state){web.saveState(state);super.onSaveInstanceState(state);}
 @Override public void onBackPressed(){if(web.canGoBack())web.goBack();else super.onBackPressed();}
 @Override protected void onDestroy(){if(chooser!=null)chooser.onReceiveValue(null);pendingBytes=null;if(web!=null){web.removeJavascriptInterface("MailroomFiles");web.removeJavascriptInterface("MailroomApi");web.destroy();web=null;network.shutdownNow();}super.onDestroy();}
}
