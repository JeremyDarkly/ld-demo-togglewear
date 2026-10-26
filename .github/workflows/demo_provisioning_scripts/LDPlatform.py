import requests
import json
import re
import time
import uuid


class LDPlatform:
    ##################################################
    # Member variables
    ##################################################
    project_key = ""
    api_key = ""
    api_key_user = ""
    client_id = ""
    sdk_key = ""
    user_id = None
    account_id = None
    project_internal_id = None

    ##################################################
    # Constructor
    ##################################################
    def __init__(self, api_key, api_key_user, email):
        self.api_key = api_key
        self.api_key_user = api_key_user
        # One shared connection pool for all API calls (avoids a new TLS
        # handshake per request)
        self._session = requests.Session()
        # Caches for resources that are stable for the lifetime of a
        # provisioning run — used to avoid re-fetching the same objects
        self._flag_cache = {}            # flag_key -> flag JSON (variations/defaults only change at create time)
        self._ai_config_cache = {}       # ai_config_key -> ai config JSON (invalidated on variation writes)
        self._ai_variation_ids = {}      # (ai_config_key, variation_key) -> variation _id
        self._pipeline_phase_cache = {}  # pipeline_key -> phase id dict
        self._metric_group_known = {}    # group_key -> bool (existence)
        self._exp_settings = None        # experimentation-settings randomizationUnits list
        self.user_id = self.get_user_id(email)
        self._fetch_member_me()

    def _extract_account_id(self, data):
        if not isinstance(data, dict):
            return None
        for key in ("_accountId", "accountId", "account_id"):
            val = data.get(key)
            if val:
                return str(val)
        acc = data.get("account")
        if isinstance(acc, dict):
            for key in ("_id", "id", "key"):
                val = acc.get(key)
                if val:
                    return str(val)
        return None

    def _fetch_account_id_fallbacks(self):
        if self.account_id:
            return
        try:
            if self.user_id:
                res = self.getrequest(
                    "GET",
                    f"https://app.launchdarkly.com/api/v2/members/{self.user_id}",
                    headers={"Authorization": self.api_key, "Content-Type": "application/json"},
                )
                if res.status_code == 200:
                    self.account_id = self._extract_account_id(res.json())
        except Exception as e:
            print(f"Warning: GET /api/v2/members/{{id}} failed: {e}")
        if self.account_id:
            return
        try:
            res = self.getrequest(
                "GET",
                "https://app.launchdarkly.com/api/v2/account",
                headers={"Authorization": self.api_key, "Content-Type": "application/json"},
            )
            if res.status_code == 200:
                data = res.json()
                self.account_id = self._extract_account_id(data) or (str(data["_id"]) if data.get("_id") else None)
        except Exception:
            pass

    def _fetch_member_me(self):
        try:
            res = self.getrequest(
                "GET",
                "https://app.launchdarkly.com/api/v2/members/me",
                headers={"Authorization": self.api_key, "Content-Type": "application/json"},
            )
            if res.status_code == 200:
                data = res.json()
                self.account_id = self._extract_account_id(data)
                if not self.user_id:
                    self.user_id = data.get("_id")
            else:
                print(f"Warning: /api/v2/members/me returned {res.status_code}")
        except Exception as e:
            print(f"Warning: Failed to fetch /api/v2/members/me: {e}")
        self._fetch_account_id_fallbacks()

    # Rate limit tuning
    MAX_RETRIES = 5                # retries for 429 responses
    LOW_REMAINING_THRESHOLD = 2    # preemptive throttle when bucket nearly empty
    MAX_PREEMPTIVE_SLEEP = 10.0    # cap (seconds) on preemptive waits
    # Transient-failure retries (5xx responses and network errors) are separate
    # from 429 rate-limit retries so a single bad API call doesn't burn the
    # whole 429 budget.
    MAX_TRANSIENT_RETRIES = 3
    TRANSIENT_STATUS_CODES = (500, 502, 503, 504)

    def getrequest(self, method, url, json=None, headers=None, data=None):
        """Make an API request with connection reuse and rate-limit handling.

        - Retries on HTTP 429 up to MAX_RETRIES times, honoring the
          Retry-After / X-Ratelimit-Reset headers with capped backoff.
        - Retries on HTTP 5xx and network errors (ConnectionError, Timeout)
          up to MAX_TRANSIENT_RETRIES times with exponential backoff. This
          protects against the transient "empty body" responses that were
          causing json.loads() to blow up downstream.
        - If the route bucket is nearly empty after a successful call,
          sleeps only until the advertised reset time (capped) so the
          next call doesn't hit a 429.
        - Always returns a requests.Response (never a string).
        """
        response = None
        transient_attempts = 0
        for attempt in range(self.MAX_RETRIES + 1):
            try:
                response = self._session.request(
                    method, url, json=json, headers=headers, data=data
                )
            except (requests.exceptions.ConnectionError,
                    requests.exceptions.Timeout) as e:
                if transient_attempts >= self.MAX_TRANSIENT_RETRIES:
                    print(f"Network error after {transient_attempts} retries: "
                          f"{method} {url}: {e}")
                    raise
                delay = min(0.5 * (2 ** transient_attempts), 10.0)
                print(f"Network error on {method} {url} (attempt "
                      f"{transient_attempts + 1}/{self.MAX_TRANSIENT_RETRIES}), "
                      f"retrying in {delay:.1f}s: {e}")
                transient_attempts += 1
                time.sleep(delay)
                continue

            if response.status_code in self.TRANSIENT_STATUS_CODES:
                if transient_attempts < self.MAX_TRANSIENT_RETRIES:
                    delay = min(0.5 * (2 ** transient_attempts), 10.0)
                    print(f"Transient {response.status_code} on {method} {url} "
                          f"(attempt {transient_attempts + 1}/"
                          f"{self.MAX_TRANSIENT_RETRIES}), retrying in {delay:.1f}s")
                    transient_attempts += 1
                    time.sleep(delay)
                    continue
                print(f"Transient error persisted after "
                      f"{self.MAX_TRANSIENT_RETRIES} retries: "
                      f"HTTP {response.status_code} {method} {url}")
                break

            if response.status_code != 429:
                break
            if attempt == self.MAX_RETRIES:
                print(f"Rate limit exceeded after {self.MAX_RETRIES} retries: {method} {url}")
                break
            time.sleep(self._rate_limit_delay(response, attempt))

        # Preemptive throttle: wait for the route bucket to refill when
        # it is nearly empty, but never longer than the reset window.
        remaining = response.headers.get("X-Ratelimit-Route-Remaining")
        if remaining is not None:
            try:
                if int(remaining) <= self.LOW_REMAINING_THRESHOLD:
                    reset_ms = int(response.headers.get("X-Ratelimit-Reset", 0))
                    delay = (reset_ms - time.time() * 1000) / 1000.0
                    if delay > 0:
                        time.sleep(min(delay, self.MAX_PREEMPTIVE_SLEEP))
            except ValueError:
                pass

        return response

    def _rate_limit_delay(self, response, attempt):
        """Seconds to wait before retrying a 429 response."""
        retry_after = response.headers.get("Retry-After")
        if retry_after:
            try:
                return max(float(retry_after), 0.5)
            except ValueError:
                pass
        reset_ms = response.headers.get("X-Ratelimit-Reset")
        if reset_ms:
            try:
                delay = (int(reset_ms) - time.time() * 1000) / 1000.0
                if delay > 0:
                    return min(max(delay, 0.5), 30.0)
            except ValueError:
                pass
        # Fallback: exponential backoff
        return min(0.5 * (2 ** attempt), 30.0)

    def _parse_json_response(self, response, context=""):
        """Safely parse a response body as JSON.

        Returns {} on empty or invalid bodies (with a warning log) instead
        of raising JSONDecodeError. This keeps downstream ``if "message"
        in data`` checks working as no-ops when the body is unusable,
        instead of the whole provisioning run crashing.
        """
        if response is None:
            print(f"Warning: no response object to parse{' for ' + context if context else ''}")
            return {}
        text = response.text or ""
        if not text.strip():
            print(f"Warning: empty response body{' for ' + context if context else ''} "
                  f"(HTTP {response.status_code})")
            return {}
        try:
            return json.loads(text)
        except json.JSONDecodeError as e:
            print(f"Warning: could not decode JSON response"
                  f"{' for ' + context if context else ''} "
                  f"(HTTP {response.status_code}): {e}")
            print(f"Response text (first 500 chars): {text[:500]}")
            return {}

    ##################################################
    # Create a project
    ##################################################
    def create_project(self, project_key, project_name):
        self.project_key = project_key
        payload = {
            "key": project_key,
            "name": project_name, 
            "defaultClientSideAvailability": {
                "usingEnvironmentId": True,
                "usingMobileKey": True,
            },
        }

        response = self.getrequest(
            "POST",
            "https://app.launchdarkly.com/api/v2/projects",
            json=payload,
            headers={"Authorization": self.api_key, "Content-Type": "application/json"},
        )

        # Project already exists — fetch its IDs instead of creating
        if response.status_code == 409:
            self.project_exists(project_key)
            return

        # Check if the response is successful
        if response.status_code != 200 and response.status_code != 201:
            print(f"Error creating project: HTTP {response.status_code}")
            print(f"Response: {response.text}")
            return

        # Parse response with error handling
        try:
            data = json.loads(response.text)
        except json.JSONDecodeError as e:
            print(f"JSON decode error: {e}")
            print(f"Response status: {response.status_code}")
            print(f"Response text: {response.text[:500]}...")
            return

        # Check if response contains expected data structure
        if "environments" not in data:
            print(f"Error: Response does not contain 'environments' key")
            print(f"Response status: {response.status_code}")
            print(f"Response: {response.text[:500]}...")
            return

        self.project_internal_id = data.get("_id")
        if not self.account_id:
            aid = self._extract_account_id(data)
            if aid:
                self.account_id = aid

        # Extract environment information
        for e in data["environments"]:
            if e["key"] == "production":
                self.client_id = e["_id"]
                self.sdk_key = e["apiKey"]

        if "message" in data:
            print("Error creating project: " + data["message"])

        # remove comment and confirm requirements
        payload = [
            {"op": "replace", "path": "/requireComments", "value": False},
            {"op": "replace", "path": "/confirmChanges", "value": False},
        ]
        self.getrequest(
            "PATCH",
            "https://app.launchdarkly.com/api/v2/projects/"
            + project_key
            + "/environments/production",
            json=payload,
            headers={
                "Authorization": self.api_key,
                "Content-Type": "application/json",
                "LD-API-Version": "beta",
            },
        )
        return response
    
    ##################################################
    # Create an environment
    ##################################################
    def create_environment(self, env_key, env_name):
        payload = {"key": env_key, "name": env_name, "color": "DADBEE"}
        response = self.getrequest(
            "POST",
            "https://app.launchdarkly.com/api/v2/projects/" + self.project_key + "/environments",
            json=payload,
            headers={"Authorization": self.api_key, "Content-Type": "application/json"},
        )
        data = self._parse_json_response(response, context=f"create_environment {env_key}")
        if "message" in data:
            print("Error creating environment: " + data["message"])
        return response
    ##################################################

    ##################################################
    # Delete a project
    ##################################################
    def delete_project(self):
        res = self.getrequest(
            "DELETE",
            "https://app.launchdarkly.com/api/v2/projects/" + self.project_key,
            headers={"Authorization": self.api_key},
        )

    ##################################################
    # The store's reset key
    ##################################################
    # Tokens belong to the account, not the project, so deleting a project
    # leaves its token behind. Each project's is found by this exact name,
    # which delete_reset_tokens and the Delete workflow both rely on.
    def reset_token_name(self):
        return "togglewear-reset-" + self.project_key

    def delete_reset_tokens(self):
        headers = {"Authorization": self.api_key, "LD-API-Version": "20240415"}
        stale, offset = [], 0
        while True:
            res = self.getrequest(
                "GET",
                f"https://app.launchdarkly.com/api/v2/tokens?showAll=true&limit=100&offset={offset}",
                headers=headers,
            )
            items = self._parse_json_response(res, context="list tokens").get("items", [])
            stale += [t["_id"] for t in items if t.get("name") == self.reset_token_name()]
            if len(items) < 100:
                break
            offset += 100
        for token_id in stale:
            self.getrequest(
                "DELETE", "https://app.launchdarkly.com/api/v2/tokens/" + token_id, headers=headers
            )
        return len(stale)

    # A service token, so it outlives whoever ran the workflow, with an inline
    # policy allowing only the changes in `changes`, in this project's `env`:
    # {"flags": [...], "ai_configs": [...]}. Returns the token's secret, or
    # None. Replaces any earlier one, so Rebuild never leaves two.
    def create_reset_token(self, env, changes):
        self.delete_reset_tokens()
        scope = f"proj/{self.project_key}:env/{env}"
        policy = []
        if changes.get("flags"):
            policy.append({
                "effect": "allow",
                "actions": ["updateOn", "updateFallthrough"],
                "resources": [f"{scope}:flag/{key}" for key in changes["flags"]],
            })
        if changes.get("ai_configs"):
            policy.append({
                "effect": "allow",
                "actions": ["updateAIConfigTargeting"],
                "resources": [f"{scope}:aiconfig/{key}" for key in changes["ai_configs"]],
            })
        res = self.getrequest(
            "POST",
            "https://app.launchdarkly.com/api/v2/tokens",
            headers={"Authorization": self.api_key, "LD-API-Version": "20240415",
                     "Content-Type": "application/json"},
            json={
                "name": self.reset_token_name(),
                "description": "The Reset demo button in this ToggleWear store. "
                               "Removed by the Delete and Rebuild workflows.",
                "serviceToken": True,
                "inlineRole": policy,
                "defaultApiVersion": 20240415,
            },
        )
        data = self._parse_json_response(res, context="create reset token")
        if "message" in data:
            print("Error creating reset token: " + data["message"])
            return None
        return data.get("token")

    ##################################################
    # Create a flag
    ##################################################
    def create_flag(
        self,
        flag_key,
        flag_name,
        description,
        variations=[],
        purpose=None,
        on_variation=0,
        off_variation=1,
        tags=[],
        migration_stages=0,
        prerequisites=[],
        temporary=False,
    ):
        payload = {
            "key": flag_key,
            "name": flag_name,
            "description": description,
            "clientSideAvailability": {
                "usingEnvironmentId": True,
                "usingMobileKey": True,
            },
            "temporary": temporary,
            "maintainerId": self.user_id
        }

        if len(variations) > 0:
            payload["variations"] = variations

        if migration_stages > 0:
            payload["migrationSettings"] = {
                "contextKind": "user",
                "stageCount": migration_stages,
            }

        if len(prerequisites) > 0:
            payload["initialPrerequisites"] = prerequisites

        if purpose is None:
            payload["defaults"] = {
                "onVariation": on_variation,
                "offVariation": off_variation,
            }
        else:
            payload["purpose"] = purpose

        if len(tags) > 0:
            payload["tags"] = tags

        headers = {
            "Content-Type": "application/json",
            "Authorization": self.api_key,
        }
        response = self.getrequest(
            "POST",
            "https://app.launchdarkly.com/api/v2/flags/" + self.project_key,
            json=payload,
            headers=headers,
        )
        # Flag already exists — nothing to do (replaces the GET pre-check)
        if response.status_code == 409:
            return
        data = json.loads(response.text)
        if "message" in data:
            print("Error creating flag: " + data["message"])
        else:
            # Seed the flag cache so later variation lookups skip the GET
            self._flag_cache[flag_key] = data
        return response
    
    ##################################################
    # Update a flag
    ##################################################
    def update_flag_client_side_availability(self, flag_key):

        payload = {
            "instructions": [ 
                { 
                    "kind": "turnOnClientSideAvailability", "value": "usingEnvironmentId" 
                } 
            ]
        }
        
        headers = {
            "Authorization": self.api_key,
            "Content-Type": "application/json; domain-model=launchdarkly.semanticpatch",
        }
                                             
        url = "https://app.launchdarkly.com/api/v2/flags/" + self.project_key + "/" + flag_key
        res = self.getrequest("PATCH", url, headers=headers, json=payload)        
        return res

    ##################################################
    # Copy a flag
    ##################################################
    def copy_flag_settings(self, flag_key, source_env_key, target_env_key):

        payload = {
            "comment": "copy feature flag settings",
            "source": {
                "key": source_env_key
            },
            "target": {
                "key": target_env_key
            }
        }

        headers = {
            "Content-Type": "application/json",
            "Authorization": self.api_key,
        }
        response = self.getrequest(
            "POST",
            "https://app.launchdarkly.com/api/v2/flags/"
            + self.project_key
            + "/"
            + flag_key
            + "/copy",
            json=payload,
            headers=headers,
        )
        data = json.loads(response.text)
        if "message" in data:
            print("Error copying flag: " + data["message"])
        return response
    
    ##################################################
    # Create AI Config
    ##################################################
    
    def create_ai_config(self, config_key, config_name, description, tags, mode=None, evaluation_metric_key=None, is_inverted=None, default_variation=None):
        
        payload = {
            "description": description,
            "key": config_key,
            "name": config_name,
            "tags": tags
        }
        if mode:
            payload["mode"] = mode
        if evaluation_metric_key is not None:
            payload["evaluationMetricKey"] = evaluation_metric_key
        if is_inverted is not None:
            payload["isInverted"] = is_inverted
        if default_variation is not None:
            payload["defaultVariation"] = default_variation
        
        headers = {
            "Content-Type": "application/json",
            "Authorization": self.api_key,
            "LD-API-Version": "beta",
        }
        
        if self.user_id:
            payload["maintainerId"] = self.user_id
        
        response = self.getrequest(
            "POST",
            "https://app.launchdarkly.com/api/v2/projects/"+ self.project_key +"/ai-configs",
            json=payload,
            headers=headers,
        )
        data = json.loads(response.text)
        if "message" in data:
            print("Error creating AI Config: " + data["message"])
        return response

    ##################################################
    # Create AI Tool (library tool with key, description, schema)
    # https://launchdarkly.com/docs/api/ai-configs/post-ai-tool
    ##################################################

    def create_ai_tool(self, tool_key, description=None, schema=None, custom_parameters=None):
        """Create an AI tool in the project.

        API reference: https://launchdarkly.com/docs/api/ai-configs/post-ai-tool

        Args:
            tool_key: Unique key for the tool.
            description: Human-readable description shown in the LD UI.
            schema: JSON Schema object describing the tool's parameters.
            custom_parameters: Optional custom metadata dict.

        Returns:
            requests.Response — the raw API response (JSON body includes
            ``key`` and ``version`` on success).
        """
        payload = {
            "key": tool_key,
            "schema": schema if schema is not None else {"properties": {}, "additionalProperties": False, "required": []}
        }
        if description:
            payload["description"] = description
        if custom_parameters is not None:
            payload["customParameters"] = custom_parameters
        if self.user_id:
            payload["maintainerId"] = self.user_id

        headers = {
            "Content-Type": "application/json",
            "Authorization": self.api_key,
            "LD-API-Version": "beta",
        }

        response = self.getrequest(
            "POST",
            f"https://app.launchdarkly.com/api/v2/projects/{self.project_key}/ai-tools",
            json=payload,
            headers=headers,
        )

        if response.text.strip():
            try:
                data = json.loads(response.text)
                if "message" in data:
                    print(f"  Error creating AI tool {tool_key}: {data['message']}")
                else:
                    print(f"  AI tool created: {tool_key}")
            except json.JSONDecodeError:
                pass
        return response
        
    
    ##################################################
    # Create AI Config Versions
    ##################################################
        
    def create_ai_config_versions(self, ai_config_key, ai_config_version_key, ai_model_config_key, ai_config_version_name, model, messages=None, custom=None, instructions=None, description=None):
        
        payload = {
            "key": ai_config_version_key,
            "name": ai_config_version_name,
            "model": model,
            "modelConfigKey": ai_model_config_key,
            "tools": [],
            "toolKeys": []
        }
        if instructions is not None:
            payload["instructions"] = instructions
        if description is not None:
            payload["description"] = description
        if messages is not None:
            payload["messages"] = messages
        if custom is not None:
            payload["custom"] = custom

        headers = {
            "Content-Type": "application/json",
            "Authorization": self.api_key,
            "LD-API-Version": "beta",
        }

        response = self.getrequest(
            "POST",
            "https://app.launchdarkly.com/api/v2/projects/" + self.project_key + "/ai-configs/" + ai_config_key + "/variations",
            json=payload,
            headers=headers,
        )
        
        if response.text.strip():
            try:
                data = json.loads(response.text)
                if "message" in data:
                    print("Error creating AI config version: " + data["message"])
                elif data.get("_id"):
                    # Seed the variation ID map so later lookups skip the GET
                    self._ai_variation_ids[
                        (ai_config_key, data.get("key", ai_config_version_key))
                    ] = data["_id"]
            except json.JSONDecodeError as e:
                print(f"JSON decode error: {e}")
                print(f"Response status: {response.status_code}")
                print(f"Response text: {response.text[:500]}...")
        else:
            print("Empty response received from AI config version API")

        # The config's variation list changed — drop any cached copy
        self._ai_config_cache.pop(ai_config_key, None)
        return response

    ##################################################
    # Attach tools to an AI Config variation
    # https://launchdarkly.com/docs/api/ai-configs/patch-ai-config-variation
    ##################################################

    def patch_variation_tools(self, ai_config_key, variation_key, tools):
        """Attach tools to an existing AI Config variation.

        Uses PATCH to update the variation with a ``tools`` array of
        ``{key, version}`` objects.  The variation must already exist
        (created via ``create_ai_config_versions``).

        Args:
            ai_config_key: Key of the parent AI Config.
            variation_key: Key of the variation to update.
            tools: List of dicts, each with ``key`` (str) and ``version`` (int).

        Returns:
            requests.Response — the raw API response.
        """
        payload = {"tools": tools}
        headers = {
            "Content-Type": "application/json",
            "Authorization": self.api_key,
            "LD-API-Version": "beta",
        }
        url = (
            "https://app.launchdarkly.com/api/v2/projects/"
            + self.project_key
            + "/ai-configs/"
            + ai_config_key
            + "/variations/"
            + variation_key
        )
        response = self.getrequest("PATCH", url, json=payload, headers=headers)
        self._ai_config_cache.pop(ai_config_key, None)
        if response.text.strip():
            try:
                data = json.loads(response.text)
                if "message" in data:
                    print(f"Error attaching tools to {ai_config_key}/{variation_key}: {data['message']}")
            except json.JSONDecodeError:
                pass
        return response

    ##################################################
    # Attach judge to AI Config variation
    ##################################################
    def attach_judge_to_variation(self, ai_config_key, variation_key, judge_config_key, sampling_rate=1.0):
        """Attach a single judge to a variation. Note: this replaces all existing judges on the variation."""
        return self.attach_judges_to_variation(ai_config_key, variation_key, [{"judgeConfigKey": judge_config_key, "samplingRate": sampling_rate}])

    def attach_judges_to_variation(self, ai_config_key, variation_key, judges):
        """Attach multiple judges to a variation. Each judge is a dict with judgeConfigKey and samplingRate.
        Note: this replaces all existing judges on the variation."""
        url = (
            "https://app.launchdarkly.com/api/v2/projects/"
            + self.project_key
            + "/ai-configs/"
            + ai_config_key
            + "/variations/"
            + variation_key
        )
        headers = {
            "Content-Type": "application/json",
            "Authorization": self.api_key,
            "LD-API-Version": "beta",
        }
        payload = {
            "judgeConfiguration": {
                "judges": judges
            }
        }
        response = self.getrequest("PATCH", url, json=payload, headers=headers)
        self._ai_config_cache.pop(ai_config_key, None)
        judge_keys = [j["judgeConfigKey"] for j in judges]
        if response.text.strip():
            try:
                data = json.loads(response.text)
                if "message" in data:
                    print(f"  Error attaching judges {', '.join(judge_keys)} to {ai_config_key}/{variation_key}: {data['message']}")
            except json.JSONDecodeError:
                pass
        return response

    ##################################################
    # Upload dataset for Playgrounds/Offline Evals
    ##################################################

    def upload_dataset(self, dataset_name, csv_content, filename=None):
        """Upload a CSV or JSONL dataset for Playground offline evaluations.

        Two-step flow:
          1. POST to /internal/projects/{key}/datasets to create the record
             and obtain a pre-signed S3 upload URL.
          2. PUT the raw file bytes to that URL.

        Requires account_id, user_id, project_internal_id and X-Ld-* headers.

        Args:
            dataset_name: Human-readable name shown in the Datasets tab.
            csv_content: The file content as a string. A .jsonl filename
                makes it JSONL, one row per line, which unlike CSV can give
                each row its own variables for the prompt's {{placeholders}}.
            filename: Optional filename (defaults to dataset_name + '.csv').

        Returns:
            The dataset ID on success, or None on failure.
        """
        if not self.account_id or not self.user_id or not self.project_internal_id:
            print(f"Error: Missing required IDs for dataset upload (account={self.account_id}, member={self.user_id}, project={self.project_internal_id})")
            return None

        if filename is None:
            filename = dataset_name.replace(" ", "_") + ".csv"

        csv_bytes = csv_content.encode("utf-8")

        headers = {
            "Content-Type": "application/json",
            "Authorization": self.api_key,
            "X-Ld-Accountid": self.account_id,
            "X-Ld-Mbrid": self.user_id,
            "X-Ld-Prjid": self.project_internal_id,
        }

        payload = {
            "name": dataset_name,
            "key": re.sub(r"[^a-z0-9]+", "-", dataset_name.lower()).strip("-"),
            "filename": filename,
            "format": "jsonl" if filename.endswith(".jsonl") else "csv",
            "size_bytes": len(csv_bytes),
        }

        response = self.getrequest(
            "POST",
            f"https://app.launchdarkly.com/internal/projects/{self.project_key}/datasets",
            json=payload,
            headers=headers,
        )

        if response.status_code not in (200, 201):
            print(f"Error creating dataset '{dataset_name}': {response.status_code} {response.text[:300]}")
            return None

        data = response.json()
        dataset_id = data.get("datasetId")
        upload_info = data.get("upload", {})
        upload_url = upload_info.get("uploadUrl")
        upload_method = upload_info.get("uploadMethod", "PUT")
        upload_headers = upload_info.get("uploadHeaders", {"Content-Type": "text/csv"})

        if not upload_url:
            print(f"Error: No upload URL returned for dataset '{dataset_name}'")
            return None

        upload_resp = self.getrequest(
            upload_method,
            upload_url,
            data=csv_bytes,
            headers=upload_headers,
        )

        if upload_resp.status_code in (200, 204):
            print(f"  Dataset uploaded: {dataset_name} ({csv_content.count(chr(10))} rows)")
            # LaunchDarkly reads the file in the background, and refuses to
            # run an evaluation over the dataset until it is ready.
            for _ in range(30):
                status = self.getrequest(
                    "GET",
                    f"https://app.launchdarkly.com/internal/projects/{self.project_key}/datasets/{dataset_id}",
                    headers=headers,
                ).json().get("status")
                if status == "ready":
                    break
                time.sleep(2)
            else:
                print(f"  Warning: dataset '{dataset_name}' is not ready yet ({status})")
            return dataset_id
        else:
            print(f"  Error uploading CSV to S3 for '{dataset_name}': {upload_resp.status_code}")
            return None

    ##################################################
    # Create Evaluation (for Playgrounds)
    ##################################################

    def create_evaluation(self, name, generation_provider, generation_model,
                          messages=None, criteria=None, evaluation_provider=None,
                          evaluation_model=None, variables=None, parameters=None,
                          prompt_snippets=None):
        # prompt_snippets: {snippet key: text} for the {{snippet.key#1}}
        # references in messages, which the evaluation does not look up
        # in the Library itself.
        if not self.account_id or not self.user_id or not self.project_internal_id:
            print(f"Error: Missing required IDs for evaluation creation")
            return None

        headers = {
            "Content-Type": "application/json",
            "Authorization": self.api_key,
            "X-Ld-Accountid": self.account_id,
            "X-Ld-Mbrid": self.user_id,
            "X-Ld-Prjid": self.project_internal_id,
        }

        payload = {
            "name": name,
            "generationProvider": generation_provider,
            "generationModel": generation_model,
        }
        if messages is not None:
            payload["messages"] = messages
        if criteria is not None:
            payload["criteria"] = criteria
        if evaluation_provider is not None:
            payload["evaluationProvider"] = evaluation_provider
        if evaluation_model is not None:
            payload["evaluationModel"] = evaluation_model
        if variables is not None:
            payload["variables"] = variables
        if parameters is not None:
            payload["parameters"] = parameters
        if prompt_snippets is not None:
            payload["promptSnippets"] = prompt_snippets

        response = self.getrequest(
            "POST",
            f"https://app.launchdarkly.com/internal/projects/{self.project_key}/evaluations",
            json=payload,
            headers=headers,
        )

        if response.status_code not in (200, 201):
            print(f"Error creating evaluation '{name}': {response.status_code} {response.text[:300]}")
            return None

        data = response.json()
        eval_id = data.get("id")
        return eval_id

    ##################################################
    # Create Playground
    ##################################################

    def create_playground(self, name, evaluation_ids):
        if not self.account_id or not self.user_id or not self.project_internal_id:
            print(f"Error: Missing required IDs for playground creation")
            return None

        headers = {
            "Content-Type": "application/json",
            "Authorization": self.api_key,
            "X-Ld-Accountid": self.account_id,
            "X-Ld-Mbrid": self.user_id,
            "X-Ld-Prjid": self.project_internal_id,
        }

        variants = [
            {"evaluationId": eid, "position": idx}
            for idx, eid in enumerate(evaluation_ids)
        ]

        payload = {
            "name": name,
            "variants": variants,
        }

        response = self.getrequest(
            "POST",
            f"https://app.launchdarkly.com/internal/projects/{self.project_key}/playgrounds",
            json=payload,
            headers=headers,
        )

        if response.status_code not in (200, 201):
            print(f"Error creating playground '{name}': {response.status_code} {response.text[:300]}")
            return None

        data = response.json()
        playground_id = data.get("id")
        return playground_id

    ##################################################
    # Run an Evaluation over a Dataset (in a Playground)
    ##################################################

    # Starts the run and returns its ID; LaunchDarkly runs every row in the
    # background, so the results appear in the playground a little later.
    def start_evaluation_run(self, evaluation_id, playground_id, dataset_id):
        headers = {
            "Content-Type": "application/json",
            "Authorization": self.api_key,
            "X-Ld-Accountid": self.account_id,
            "X-Ld-Mbrid": self.user_id,
            "X-Ld-Prjid": self.project_internal_id,
        }
        response = self.getrequest(
            "POST",
            f"https://app.launchdarkly.com/internal/projects/{self.project_key}/evaluations/{evaluation_id}/runs",
            json={"playgroundId": playground_id, "datasetId": dataset_id, "rowSelectionMode": "all"},
            headers=headers,
        )
        if response.status_code not in (200, 201):
            print(f"Error starting evaluation run: {response.status_code} {response.text[:300]}")
            return None
        return response.json().get("id")

    ##################################################
    # Create AI Agent
    ##################################################
    
    def create_ai_agent(self, agent_key, agent_name, description, maintainer_id=None, maintainer_team_key=None, mode="agent", tags=None):
        
        payload = {
            "key": agent_key,
            "name": agent_name,
            "description": description,
            "mode": mode,
            "tags": tags or []
        }
        
        if maintainer_id:
            payload["maintainerId"] = maintainer_id
        if maintainer_team_key:
            payload["maintainerTeamKey"] = maintainer_team_key
        
        headers = {
            "Content-Type": "application/json",
            "Authorization": self.api_key,
            "LD-API-Version": "beta",
        }
        
        response = self.getrequest(
            "POST",
            "https://app.launchdarkly.com/api/v2/projects/"+ self.project_key +"/ai-configs",
            json=payload,
            headers=headers,
        )
        data = json.loads(response.text)
        if "message" in data:
            print("Error creating AI Agent: " + data["message"])
        return response
    
    ##################################################
    # Create AI Agent Variations (Bulk)
    ##################################################
    
    def create_ai_agent_variations_bulk(self, agent_key, variations):
        # Create variations one by one since bulk API might not be available
        results = []
        for variation in variations:
            result = self.create_ai_agent_variation(agent_key, variation)
            results.append(result)
        return results
    
    def create_ai_agent_variation(self, agent_key, variation):
        payload = {
            "key": variation["key"],
            "name": variation["name"],
            "messages": [],  # Empty for AI agents
            "instructions": variation["instructions"],
            "model": variation["model"],
            "modelConfigKey": variation["modelConfigKey"],
            "tools": [],
            "toolKeys": []
        }
        
        # Add optional fields if present
        if "comment" in variation:
            payload["comment"] = variation["comment"]
        if "description" in variation:
            payload["description"] = variation["description"]
        
        headers = {
            "Content-Type": "application/json",
            "Authorization": self.api_key,
            "LD-API-Version": "beta",
        }
        
        response = self.getrequest(
            "POST",
            "https://app.launchdarkly.com/api/v2/projects/" + self.project_key + "/ai-configs/" + agent_key + "/variations",
            json=payload,
            headers=headers,
        )
        
        # Add better error handling for JSON parsing
        if response.text.strip():  # Only try to parse if response is not empty
            try:
                data = json.loads(response.text)
                if "message" in data:
                    print("Error creating AI Agent variation: " + data["message"])
                elif data.get("_id"):
                    # Seed the variation ID map so later lookups skip the GET
                    self._ai_variation_ids[
                        (agent_key, data.get("key", variation["key"]))
                    ] = data["_id"]
            except json.JSONDecodeError as e:
                print(f"JSON decode error: {e}")
                print(f"Response status: {response.status_code}")
                print(f"Response text: {response.text[:500]}...")
        else:
            print("Empty response received from AI agent variation API")

        # The config's variation list changed — drop any cached copy
        self._ai_config_cache.pop(agent_key, None)
        return response
    
    ##################################################
    # Create Custom Model Configuration
    ##################################################
    
    def create_custom_model_config(self, model_key, model_name, provider="LD", cost_per_input_token=0.8, cost_per_output_token=6.0, params=None, custom_params=None, tags=None, model_id=None):
        """
        Create a custom model configuration for AI agents.

        model_id is the model name handed to the provider, and defaults to the
        key. It needs to differ when the provider's name for the model has a
        character a key cannot, such as the colon in a Bedrock model id.
        """
        payload = {
            "name": model_name,
            "key": model_key,
            "id": model_id or model_key,
            "icon": "🤖",
            "provider": provider,
            "params": params or {},
            "customParams": custom_params or {},
            "tags": tags or ["custom-model", "financial-ai"],
            "costPerInputToken": cost_per_input_token,
            "costPerOutputToken": cost_per_output_token
        }
        
        headers = {
            "Content-Type": "application/json",
            "Authorization": self.api_key,
            "LD-API-Version": "beta",
        }
        
        response = self.getrequest(
            "POST",
            f"https://app.launchdarkly.com/api/v2/projects/{self.project_key}/ai-configs/model-configs",
            json=payload,
            headers=headers,
        )
        
        # Add better error handling for JSON parsing
        if response.text.strip():
            try:
                data = json.loads(response.text)
                if "message" in data:
                    print(f"Error creating custom model config {model_name}: {data['message']}")
                else:
                    print(f"Successfully created custom model config: {model_name}")
            except json.JSONDecodeError as e:
                print(f"JSON decode error for model {model_name}: {e}")
                print(f"Response status: {response.status_code}")
                print(f"Response text: {response.text[:500]}...")
        else:
            print(f"Empty response received for model config {model_name}")
            
        return response
    
    
    ##################################################
    # Create a segment
    ##################################################

    def create_segment(self, segment_key, segment_name, env_key, description=""):
        payload = {
            "key": segment_key,
            "name": segment_name,
            "description": description,
            "unbounded": False,
        }

        headers = {
            "Content-Type": "application/json",
            "Authorization": self.api_key,
        }
        response = self.getrequest(
            "POST",
            "https://app.launchdarkly.com/api/v2/segments/"
            + self.project_key
            + "/"
            + env_key,
            json=payload,
            headers=headers,
        )
        # Segment already exists — nothing to do (replaces the GET pre-check)
        if response.status_code == 409:
            return
        data = self._parse_json_response(
            response, context=f"create_segment {segment_key} in {env_key}"
        )
        if "message" in data:
            print("Error creating segment: " + data["message"])
        return response

    ##################################################
    # Add a segment rule
    ##################################################

    def add_segment_rule(
        self, segment_key, env_key, context_kind, attribute, op, value
    ):
        payload = [
            {
                "op": "add",
                "path": "/rules/0",
                "value": {
                    "clauses": [
                        {
                            "contextKind": context_kind,
                            "op": op,
                            "attribute": attribute,
                            "values": value,
                            "negate": False,
                        }
                    ],
                    "rolloutContextKind": "user",
                    "description": "",
                },
            },
        ]

        headers = {
            "Content-Type": "application/json",
            "Authorization": self.api_key,
        }
        response = self.getrequest(
            "PATCH",
            "https://app.launchdarkly.com/api/v2/segments/"
            + self.project_key
            + "/"
            + env_key
            + "/"
            + segment_key,
            json=payload,
            headers=headers,
        )
        data = self._parse_json_response(
            response, context=f"add_segment_rule {segment_key} in {env_key}"
        )
        if "message" in data:
            print("Error creating segment: " + data["message"])
        return response

    ##################################################
    # Create a metric
    ##################################################
    def create_metric(
        self,
        metric_key,
        metric_name,
        event_key,
        metric_description="",
        kind="custom",
        numeric=False,
        success_criteria="LowerThanBaseline",
        unit="",
        exclude_empty_events=False,
        randomization_units=[],
        tags=[],
        unit_aggregation_type=None,
    ):
        """unit_aggregation_type is how one context's events combine: "sum"
        makes a numeric metric a running total, which is what an adaptive
        trigger needs to count every failure rather than one per context.
        Left as None, LaunchDarkly's default applies.
        """
        payload = {
            "key": metric_key,
            "name": metric_name,
            "description": metric_description,
            "eventKey": event_key,
            "kind": kind,
            "maintainerId": self.user_id,
            "isNumeric": numeric,
            "successCriteria": success_criteria,
            "eventDefault": {"disabled": exclude_empty_events},
        }

        if len(tags) > 0:
            payload["tags"] = tags

        if numeric:
            payload["unit"] = unit

        if unit_aggregation_type:
            payload["unitAggregationType"] = unit_aggregation_type

        if randomization_units:
            payload["randomizationUnits"] = randomization_units

        headers = {
            "Content-Type": "application/json",
            "Authorization": self.api_key,
        }
        response = self.getrequest(
            "POST",
            "https://app.launchdarkly.com/api/v2/metrics/" + self.project_key,
            json=payload,
            headers=headers,
        )
        # Metric already exists — nothing to do (replaces the GET pre-check)
        if response.status_code == 409:
            return
        data = json.loads(response.text)
        if "message" in data:
            print("Error creating metric: " + data["message"])
        return response

    ##################################################
    # Create a metric group
    ##################################################
    def create_metric_group(
        self, group_key, group_name, metrics, kind="funnel", description=""
    ):
        payload = {
            "key": group_key,
            "name": group_name,
            "description": description,
            "kind": kind,
            "maintainerId": self.user_id,
            "tags": ["coast"],
            "metrics": metrics,
        }

        headers = {
            "Content-Type": "application/json",
            "Authorization": self.api_key,
            "LD-API-Version": "beta",
        }
        response = self.getrequest(
            "POST",
            "https://app.launchdarkly.com/api/v2/projects/"
            + self.project_key
            + "/metric-groups",
            json=payload,
            headers=headers,
        )
        # Metric group already exists — nothing to do (replaces the GET pre-check)
        if response.status_code == 409:
            self._metric_group_known[group_key] = True
            return
        data = json.loads(response.text)
        if "message" in data:
            print("Error creating metric group: " + data["message"])
        else:
            self._metric_group_known[group_key] = True
        return response

    ##################################################
    # Create context kind
    ##################################################
    def create_context(self, context_key, for_experiment=False):
        payload = {
            "name": context_key,
            "hideInTargeting": False,
        }

        headers = {
            "Content-Type": "application/json",
            "Authorization": self.api_key,
        }
        response = self.getrequest(
            "PUT",
            "https://app.launchdarkly.com/api/v2/projects/"
            + self.project_key
            + "/context-kinds/"
            + context_key,
            json=payload,
            headers=headers,
        )
        data = json.loads(response.text)
        if "message" in data:
            print("Error creating context: " + data["message"])

        if for_experiment:
            if self._exp_settings is not None:
                # Reuse the settings we already know from earlier in the run
                settings = [dict(s) for s in self._exp_settings]
            else:
                settings = []
                response = self.getrequest(
                    "GET",
                    "https://app.launchdarkly.com/api/v2/projects/"
                    + self.project_key
                    + "/experimentation-settings",
                    headers=headers,
                )

                # Check if the response is successful
                if response.status_code != 200:
                    print(f"Error getting experimentation settings: HTTP {response.status_code}")
                    print(f"Response: {response.text}")
                    return

                # Parse response with error handling
                try:
                    data = json.loads(response.text)
                except json.JSONDecodeError as e:
                    print(f"JSON decode error: {e}")
                    print(f"Response status: {response.status_code}")
                    print(f"Response text: {response.text[:500]}...")
                    return

                if "message" in data:
                    print("Error getting experimentation settings: " + data["message"])
                    return

                # Check if response contains expected data structure
                if "randomizationUnits" not in data:
                    print(f"Error: Response does not contain 'randomizationUnits' key")
                    print(f"Response status: {response.status_code}")
                    print(f"Response: {response.text[:500]}...")
                    return

                # Copies only the fields each unit actually has: the API leaves
                # standardRandomizationUnit off some of them, and indexing it
                # directly crashed the whole build.
                for ru in data["randomizationUnits"]:
                    item = {
                        field: ru[field]
                        for field in (
                            "randomizationUnit",
                            "standardRandomizationUnit",
                            "default",
                        )
                        if field in ru
                    }
                    settings.append(item)

            settings.append(
                {
                    "randomizationUnit": context_key,
                    "standardRandomizationUnit": "user",
                    "default": False,
                }
            )

            payload = {
                "randomizationUnits": settings,
            }

            response = self.getrequest(
                "PUT",
                "https://app.launchdarkly.com/api/v2/projects/"
                + self.project_key
                + "/experimentation-settings",
                json=payload,
                headers=headers,
            )
            data = json.loads(response.text)
            if "message" in data:
                print("Error setting experimentation settings: " + data["message"])
            else:
                # Remember the applied settings so the next call skips the GET
                self._exp_settings = settings
        return response

    ##################################################
    # Create an experiment
    ##################################################
    def create_experiment(
        self,
        exp_key,
        exp_name,
        exp_env,
        flag_key,
        hypothesis,
        metrics,
        primary_key,
        attributes=None,
        randomization_unit="user",
        custom_treatment_names=None,
        methodology="bayesian",
        analysisConfig={"bayesianThreshold": "95"},
        flagConfigVersion=None,
        treatment_values=None,
        rule_index=None,
    ):
        """treatment_values limits the experiment to the variations with those
        values, in that order, the first being the control. A flag whose rules
        serve variations of their own — a member message, say — keeps those out
        of the experiment this way.

        flagConfigVersion has to equal the flag's current version in exp_env,
        which every rule and toggle before this has moved on. Left as None it
        is read from the flag rather than counted by hand, which is how
        core-demo's hard-coded 2s went stale the moment a rule was added.

        rule_index runs the experiment on that targeting rule, counting from
        0, instead of the default rule, so only the contexts the rule matches
        are in it. An AI Config is a flag underneath, with the same key, so
        flag_key can name one.
        """
        if flagConfigVersion is None:
            flagConfigVersion = self.get_flag_env_version(flag_key, exp_env) or 1
        rule_id = "fallthrough"
        if rule_index is not None:
            rule_id = self.get_flag_rule_id(flag_key, exp_env, rule_index)
            if rule_id is None:
                return
        treatments = self.get_treatments(
            flag_key, custom_treatment_names, treatment_values
        )

        payload = {
            "name": exp_name,
            "key": exp_key,
            "maintainerId": self.user_id,
            "iteration": {
                "hypothesis": hypothesis,
                "canReshuffleTraffic": True,
                "metrics": metrics,
                "treatments": treatments,
                "flags": {
                    flag_key: {
                        "ruleId": rule_id,
                        "flagConfigVersion": flagConfigVersion,
                    },
                },
                "randomizationUnit": randomization_unit,
            },
            "methodology": methodology,
            "analysisConfig": analysisConfig,
        }

        if self.metric_group_exists(primary_key):
            payload["iteration"]["primaryFunnelKey"] = primary_key
        else:
            payload["iteration"]["primarySingleMetricKey"] = primary_key

        if attributes is not None:
            payload["iteration"]["attributes"] = attributes

        headers = {
            "Content-Type": "application/json",
            "Authorization": self.api_key,
            "LD-API-Version": "beta",
        }

        response = self.getrequest(
            "POST",
            "https://app.launchdarkly.com/api/v2/projects/"
            + self.project_key
            + "/environments/"
            + exp_env
            + "/experiments",
            json=payload,
            headers=headers,
        )
        # Experiment already exists — nothing to do (replaces the GET pre-check)
        if response.status_code == 409:
            return
        data = json.loads(response.text)
        if "message" in data:
            print("Error creating experiment: " + data["message"])
        return response

    ##################################################
    # Create a holdout
    ##################################################
    def create_holdout(
        self,
        holdout_key,
        holdout_name,
        holdout_env_key,   
        description,
        metrics,
        primary_metric_key,
        randomization_unit="users",
        attributes=None,
        prerequisiteflagkey=""
    ):

        payload = {
            "name": holdout_name,
            "key": holdout_key,
            "description": description,
            "randomizationunit": randomization_unit,
            "attributes": attributes,
            "holdoutamount": "5",
            "primarymetrickey": primary_metric_key,
            "metrics": metrics,
            "prerequisiteflagkey": prerequisiteflagkey,
            "analysisConfig": {"significanceThreshold": "5", "testDirection": "two-sided"},
            "methodology": "frequentist",
            "maintainerId": self.user_id,
        }

        headers = {
            "Content-Type": "application/json",
            "Authorization": self.api_key,
            "LD-API-Version": "beta",
        }

        response = self.getrequest(
            "POST",
            "https://app.launchdarkly.com/api/v2/projects/"
            + self.project_key
            + "/environments/"
            + holdout_env_key
            + "/holdouts",
            json=payload,
            headers=headers,
        )

        data = json.loads(response.text)
        if "message" in data:
            print("Error creating holdout: " + data["message"])
        return response

    ##################################################
    # Create a layer
    ##################################################

    def create_layer(
        self,
        # layer_key,
        # layer_name,
        description,
    ):

        payload = {
            "name": "Checkout Experiment Layer",
            "key": "checkout-experiment-layer",
            "description": description,
        }

        headers = {
            "Content-Type": "application/json",
            "Authorization": self.api_key,
        }

        response = self.getrequest(
            "POST",
            "https://app.launchdarkly.com/api/v2/projects/"
            + self.project_key
            + "/layers",
            json=payload,
            headers=headers,
        )

        data = json.loads(response.text)
        if "message" in data:
            print("Error creating layer: " + data["message"])
        return response


    def update_layer(
        self,
        layer_key,
        environmentKey,
        instructions = [],
    ):
        payload = {
            "comment": "Example comment describing the update",
            "environmentKey": environmentKey,
            "instructions": instructions
        }

        headers = {
            "Content-Type": "application/json",
            "Authorization": self.api_key,
        }

        response = self.getrequest(
            "PATCH",
            "https://app.launchdarkly.com/api/v2/projects/"
            + self.project_key
            + "/layers/"
            + layer_key,
            json=payload,
            headers=headers,
        )

        data = json.loads(response.text)
        if "message" in data:
            print("Error updating layer: " + data["message"])
        return response



    ##################################################
    # Create a release pipeline
    ##################################################
    def create_release_pipeline(self, pipeline_key, pipeline_name):
        payload = {
            "description": "Standard pipeline to roll out to production",
            "key": pipeline_key,
            "name": pipeline_name,
            "phases": [
                {
                    "audiences": [
                        {
                            "environmentKey": "test",
                            "name": "everyone",
                            "configuration": {
                                "releaseStrategy": "immediate-rollout",
                                "requireApproval": False,
                            },
                        }
                    ],
                    "name": "Testing Phase",
                },
                {
                    "audiences": [
                        {
                            "environmentKey": "production",
                            "name": "everyone",
                            "configuration": {
                                "releaseStrategy": "immediate-rollout",
                                "requireApproval": False,
                            },
                        }
                    ],
                    "name": "QA Phase",
                },
                {
                    "audiences": [
                        {
                            "environmentKey": "production",
                            "name": "everyone",
                            "configuration": {
                                "releaseStrategy": "immediate-rollout",
                                "requireApproval": False,
                            },
                        }
                    ],
                    "name": "GA",
                },
            ],
            "isProjectDefault": True,
        }

        headers = {
            "Content-Type": "application/json",
            "Authorization": self.api_key,
            "LD-API-Version": "beta",
        }
        response = self.getrequest(
            "POST",
            "https://app.launchdarkly.com/api/v2/projects/"
            + self.project_key
            + "/release-pipelines",
            json=payload,
            headers=headers,
        )
        # Pipeline already exists — nothing to do (replaces the GET pre-check)
        if response.status_code == 409:
            return
        if response.text.strip():
            try:
                data = json.loads(response.text)
                if "message" in data:
                    print("Error creating release pipeline: " + data["message"])
            except json.JSONDecodeError:
                print(f"Release pipeline: non-JSON response (status {response.status_code})")
        else:
            print(f"Release pipeline: empty response (status {response.status_code})")
        return response

    def create_shortcut(self, name, key, icon, tags, env_key, sort_by="name"):
        payload = {
            "name": name,
            "key": key,
            "icon": icon,
            "type": "flags",
            "context": {
                "projectKey": self.project_key,
                "environmentKeys": ["production"],
                "selectedEnvironmentKey": env_key,
            },
            "filters": {
                "filter": {
                    "tags": tags
                    },
                    "state": "live",
                    "sort": sort_by
                },
            "visibility": "me",
        }
        headers = {
            "Content-Type": "application/json",
            "Authorization": self.api_key_user,
            "LD-API-Version": "beta",
        }
        response = self.getrequest(
            "POST",
            "https://app.launchdarkly.com/api/v2/shortcuts",
            json=payload,
            headers=headers,
        )
        data = json.loads(response.text)
        if "message" in data:
            print("Error creating shortcut: " + data["message"])
        return response

    #####################################
    #
    # Helper functions
    #
    #####################################

    ##################################################
    # Get the User ID from the email
    ##################################################

    def get_user_id(self, email):
        if email is None:
            return None
        
        filter = "email:" + email
        if email == "":
            filter = "role:owner"

        res = self.getrequest(
            "GET",
            "https://app.launchdarkly.com/api/v2/members?filter=" + filter,
            headers={"Authorization": self.api_key, "Content-Type": "application/json"},
        )
        
        # Check if the response is successful
        if res.status_code != 200:
            print(f"Error getting user ID: HTTP {res.status_code}")
            print(f"Response: {res.text}")
            return "6502137e3310e112c47aeb92"
        
        # Parse response with error handling
        try:
            data = json.loads(res.text)
        except json.JSONDecodeError as e:
            print(f"JSON decode error: {e}")
            print(f"Response status: {res.status_code}")
            print(f"Response text: {res.text[:500]}...")
            return "6502137e3310e112c47aeb92"
        
        # Check if response contains expected data structure
        if "totalCount" not in data or "items" not in data:
            print(f"Error: Response does not contain expected keys")
            print(f"Response status: {res.status_code}")
            print(f"Response: {res.text[:500]}...")
            return "6502137e3310e112c47aeb92"
            
        if data["totalCount"] == 0:
            return "6502137e3310e112c47aeb92"

        item = data["items"][0]
        self.user_id = item["_id"]
        aid = self._extract_account_id(item)
        if aid:
            self.account_id = aid
        return self.user_id

    ##################################################
    # Check if a project exists
    ##################################################

    def project_exists(self, project_key):
        res = self.getrequest(
            "GET",
            "https://app.launchdarkly.com/api/v2/projects/" + project_key,
            headers={"Authorization": self.api_key},
        )
        data = json.loads(res.text)
        if "message" in data:
            return False
        self.project_internal_id = data.get("_id") or self.project_internal_id
        if not self.account_id:
            aid = self._extract_account_id(data)
            if aid:
                self.account_id = aid
        return True
    
    ##################################################
    # Create a user
    ##################################################
    def create_user(self, email):
        
        payload = [
            { 
                "email": email,
                "role": "admin",
            }
        ]

        headers = {
            "Content-Type": "application/json",
            "Authorization": self.api_key,
        }
        response = self.getrequest(
            "POST",
            "https://app.launchdarkly.com/api/v2/members",
            json=payload,
            headers=headers,
        )
        data = json.loads(response.text)
        if "message" in data:
            print("Error creating user: " + data["message"])
            return "demoengineering@launchdarkly.com"
        return response

    ##################################################
    # Check if a flag exists
    ##################################################
    def flag_exists(self, flag_key):
        return self._get_flag_json(flag_key) is not None

    ##################################################
    # Check if a segment exists
    ##################################################

    def segment_exists(self, segment_key, env_key):
        res = self.getrequest(
            "GET",
            "https://app.launchdarkly.com/api/v2/segments/"
            + self.project_key
            + "/"
            + env_key
            + "/"
            + segment_key,
            headers={"Authorization": self.api_key},
        )
        if res.text.strip() == "":
            return False
        return True

    ##################################################
    # Check if a metric exists
    ##################################################
    def metric_exists(self, metric_key):
        res = self.getrequest(
            "GET",
            "https://app.launchdarkly.com/api/v2/metrics/"
            + self.project_key
            + "/"
            + metric_key,
            headers={"Authorization": self.api_key},
        )
        data = json.loads(res.text)
        if "message" in data:
            return False
        return True

    ##################################################
    # Check if a metric group exists
    ##################################################
    def metric_group_exists(self, group_key):
        # Seeded by create_metric_group; negative results are cached too,
        # since groups are only created through this class during a run
        if group_key in self._metric_group_known:
            return self._metric_group_known[group_key]
        res = self.getrequest(
            "GET",
            "https://app.launchdarkly.com/api/v2/projects/"
            + self.project_key
            + "/metric-groups/"
            + group_key,
            headers={"Authorization": self.api_key, "LD-API-Version": "beta"},
        )
        data = json.loads(res.text)
        exists = "message" not in data
        self._metric_group_known[group_key] = exists
        return exists

    ##################################################
    # Check if an experiment exists
    ##################################################
    def experiment_exists(self, exp_key, exp_env):
        res = self.getrequest(
            "GET",
            "https://app.launchdarkly.com/api/v2/projects/"
            + self.project_key
            + "/environments/"
            + exp_env
            + "/experiments/"
            + exp_key,
            headers={"Authorization": self.api_key, "LD-API-Version": "beta"},
        )
        data = json.loads(res.text)
        if "message" in data:
            return False
        return True

    ##################################################
    # Check if a release pipeline exists
    ##################################################
    def release_pipeline_exists(self, pipeline_key):
        url = (
            "https://app.launchdarkly.com/api/v2/projects/"
            + self.project_key
            + "/release-pipelines/"
            + pipeline_key
        )
        res = self.getrequest(
            "GET",
            url,
            headers={
                "Content-Type": "application/json",
                "Authorization": self.api_key,
                "LD-API-Version": "beta",
            },
        )
        if res.status_code == 404:
            return False
        return True

    ##################################################
    # Build a treatment object
    ##################################################
    def treatment(self, name, baseline, allocation_percent, flag_key, variation_id):
        return {
            "name": name,
            "baseline": baseline,
            "allocationPercent": allocation_percent,
            "parameters": [
                {
                    "flagKey": flag_key,
                    "variationId": variation_id,
                },
            ],
        }

    #########################################################
    # Fetch a flag's JSON, with caching
    #########################################################
    def _get_flag_json(self, flag_key):
        """Fetch (and cache) a flag's JSON representation.

        The cache is seeded by create_flag and only read for fields that
        are stable after creation (variations, defaults), so targeting
        patches made during a run do not invalidate it.
        """
        if flag_key in self._flag_cache:
            return self._flag_cache[flag_key]

        res = self.getrequest(
            "GET",
            "https://app.launchdarkly.com/api/v2/flags/"
            + self.project_key
            + "/"
            + flag_key,
            headers={
                "Authorization": self.api_key,
                "Content-Type": "application/json",
            },
        )
        if res.status_code == 404:
            return None
        if res.status_code != 200:
            print(f"Error getting flag {flag_key}: HTTP {res.status_code}")
            print(f"Response: {res.text[:500]}")
            return None
        try:
            data = json.loads(res.text)
        except json.JSONDecodeError as e:
            print(f"JSON decode error getting flag {flag_key}: {e}")
            return None
        if "message" in data:
            return None
        self._flag_cache[flag_key] = data
        return data

    #########################################################
    # Get a flag's current version in one environment
    #########################################################
    def get_flag_env_version(self, flag_key, env_key):
        """Fetched fresh rather than from _flag_cache: the cache holds the flag
        as created, and the version is exactly the part that has moved since."""
        res = self.getrequest(
            "GET",
            "https://app.launchdarkly.com/api/v2/flags/"
            + self.project_key
            + "/"
            + flag_key
            + "?env="
            + env_key,
            headers={
                "Authorization": self.api_key,
                "Content-Type": "application/json",
            },
        )
        if res.status_code != 200:
            print(f"Error getting version of {flag_key}: HTTP {res.status_code}")
            return None
        try:
            env = json.loads(res.text)["environments"][env_key]
        except (json.JSONDecodeError, KeyError):
            print(f"Error reading version of {flag_key} in {env_key}")
            return None
        return env.get("version", env.get("_version"))

    def get_flag_rule_id(self, flag_key, env_key, index):
        """The ID of the flag's targeting rule at index in env_key, which is
        what an experiment names its rule by."""
        res = self.getrequest(
            "GET",
            "https://app.launchdarkly.com/api/v2/flags/"
            + self.project_key
            + "/"
            + flag_key
            + "?env="
            + env_key,
            headers={
                "Authorization": self.api_key,
                "Content-Type": "application/json",
            },
        )
        if res.status_code != 200:
            print(f"Error getting rules of {flag_key}: HTTP {res.status_code}")
            return None
        try:
            return json.loads(res.text)["environments"][env_key]["rules"][index]["_id"]
        except (json.JSONDecodeError, KeyError, IndexError):
            print(f"Error: {flag_key} has no rule {index} in {env_key}")
            return None

    #########################################################
    # Get the flag variation IDs with values, returns a list
    #########################################################
    def get_flag_variation_values(self, flag_key):
        var_ids = []

        data = self._get_flag_json(flag_key)
        if data is None or "defaults" not in data or "variations" not in data:
            print(f"Error getting flag variation values for {flag_key}")
            return [], {"onVariation": 0, "offVariation": 0}

        defaults = {
            "onVariation": data["defaults"]["onVariation"],
            "offVariation": data["defaults"]["offVariation"],
        }
        ordinal = 0
        for var in data["variations"]:
            var_ids.append(
                {"ordinal": ordinal, "value": var["value"], "id": var["_id"]}
            )
            ordinal += 1

        return var_ids, defaults

    ##################################################
    # Get flag variation names from LaunchDarkly API
    ##################################################
    def get_flag_variation_names(self, flag_key, segment=False):
        """
        Get the names of flag variations from LaunchDarkly API
        Returns a list of variation names (excluding 'disabled' unless segment=True)
        """
        data = self._get_flag_json(flag_key)
        if data is None or "variations" not in data:
            return []
        
        variation_names = []
        for var in data["variations"]:
            # If segment is True, include all variations (including "disabled")
            # If segment is False, exclude "disabled" as before
            if segment or var["name"] != "disabled":
                variation_names.append(var["name"])
        
        return variation_names

    ##################################################
    # Get flag variation details (names and IDs) from LaunchDarkly API
    ##################################################
    def get_flag_variation_details(self, flag_key, segment=False):
        """
        Get both names and IDs of flag variations from LaunchDarkly API
        Returns a list of dictionaries with 'name' and 'id' keys
        """
        data = self._get_flag_json(flag_key)
        if data is None or "variations" not in data:
            return []
        
        variation_details = []
        for var in data["variations"]:
            # If segment is True, include all variations (including "disabled")
            # If segment is False, exclude "disabled" as before
            if segment or var["name"] != "disabled":
                variation_details.append({
                    "name": var["name"],
                    "id": var["_id"],
                    "value": var.get("value", None)
                })
        
        return variation_details

    ##################################################
    # Get the flag variation IDs, returns a list
    ##################################################
    def get_flag_variations(self, flag_key, filter=None, segment=False):
        var_ids = []
        data = self._get_flag_json(flag_key)
        if data is None or "variations" not in data:
            return []
        for var in data["variations"]:
            # If segment is True, include all variations (including "disabled")
            # If segment is False, exclude "disabled" as before
            if segment or var["name"] != "disabled":
                if filter is not None:
                    if var["value"] == filter:
                        var_ids.append(var["_id"])
                else:
                    var_ids.append(var["_id"])
        return var_ids

    ##################################################
    # Create a list of treatments, returns a list
    ##################################################
    def get_treatments(self, flag_key, name_list=None, values=None):
        # Get both variation IDs and names in one API call for efficiency
        variation_details = self.get_flag_variation_details(flag_key)
        # A subset, in the order given, so the first value is the control
        # whatever order the flag declares its variations in.
        if values is not None:
            by_value = {repr(v["value"]): v for v in variation_details}
            missing = [v for v in values if repr(v) not in by_value]
            if missing:
                print(f"Error: {flag_key} has no variations with values {missing}")
                return
            variation_details = [by_value[repr(v)] for v in values]
        treatments = [var["id"] for var in variation_details]
        ret_treatments = []
        names = []

        if name_list is not None:
            if len(name_list) != len(treatments):
                print("Error: name list length does not match the number of treatments")
                return
            else:
                names = name_list.copy()
        else:
            # Use actual flag variation names from LaunchDarkly API
            names = [var["name"] for var in variation_details]
        allocs = []
        total = 0.0
        for i in range(len(treatments)):
            x = round(float(100 / len(treatments)), 2)
            allocs.append(x)
            total += x

        if total > 100.0:
            allocs[0] = float(allocs[0]) - (total - 100.0)
        if total < 100.0:
            allocs[0] = allocs[0] + (100.0 - total)

        for i in range(len(treatments)):
            is_control = False
            if i == 0:
                is_control = True
            ret_treatments.append(
                self.treatment(
                    names[i],
                    is_control,
                    allocs[i],
                    flag_key,
                    treatments[i],
                )
            )

        return ret_treatments

    ##################################################
    # Experiment metric object
    ##################################################
    def exp_metric(self, key, is_group=True):
        return {
            "key": key,
            "isGroup": is_group,
        }

    ##################################################
    # List of experiment metrics
    ##################################################
    def get_exp_metrics(self, metric_list):
        retval = []
        for m in metric_list:
            retval.append(m)

        return retval

    ##################################################
    # Build automated release semantic patch instructions
    ##################################################
    def _default_automated_release_stages(self, duration_ms):
        return [
            {"allocation": 1000, "durationMillis": duration_ms},
            {"allocation": 5000, "durationMillis": duration_ms},
            {"allocation": 10000, "durationMillis": duration_ms},
            {"allocation": 25000, "durationMillis": duration_ms},
            {"allocation": 50000, "durationMillis": duration_ms},
        ]

    def _build_start_automated_release_instruction(
        self,
        control_variation_id,
        target_variation_id,
        stages,
        release_kind="guarded",
        metrics=None,
        rollback=True,
        rule_id=None,
    ):
        instruction = {
            "kind": "startAutomatedRelease",
            "releaseKind": release_kind,
            "originalVariationId": control_variation_id,
            "targetVariationId": target_variation_id,
            "randomizationUnit": "user",
            "stages": stages,
        }
        if rule_id:
            instruction["ruleId"] = rule_id
        if metrics:
            instruction["metrics"] = [
                {"key": metric, "isGroup": False} for metric in metrics
            ]
            instruction["metricMonitoringPreferences"] = {
                metric: {"autoRollback": rollback} for metric in metrics
            }
        return instruction

    def _build_stop_automated_release_instruction(
        self, final_variation_id, rule_id=None
    ):
        instruction = {
            "kind": "stopAutomatedRelease",
            "finalVariationId": final_variation_id,
        }
        if rule_id:
            instruction["ruleId"] = rule_id
        return instruction

    ##################################################
    # Add a guarded rollout to a flag
    ##################################################
    def add_guarded_rollout(
        self,
        flag_key,
        env_key,
        timeout=604800000,
        rollback=True,
        days=1,
        metrics=[],
        stages=None,
    ):
        # stages overrides the default 1/5/10/25/50 ramp. A failing-rollout
        # demo needs it: at 1% allocation the treatment gets too few events for
        # the regression detector to reach significance before the ramp is over,
        # which is why core-demo had to hand-roll that flag instead of calling
        # this. Pass allocations in thousandths with durationMillis per stage.
        # Since this is likely going to be added immediately after
        # creating a flag, we're going to sleep for 2 seconds. Otherwise
        # adding the rollout doesn't consistently take.
        time.sleep(2)
        
        vars, defaults = self.get_flag_variation_values(flag_key)

        control_var = ""
        test_var = ""
        stagesWindow = 120000

        if days == 7:
            stagesWindow = 120960000
        elif days == 4:
            stagesWindow = 1800000  # 30 minutes per stage
        elif days == 3:
            stagesWindow = 900000  # 15 minutes per stage

        for v in vars:
            if v["value"] == False:
                control_var = v["id"]
            else:
                test_var = v["id"]

        url = (
            "https://app.launchdarkly.com/api/v2/flags/"
            + self.project_key
            + "/"
            + flag_key
            + "?ignoreConflicts=true"
        )
        headers = {
            "Authorization": self.api_key,
            "Content-Type": "application/json; domain-model=launchdarkly.semanticpatch",
        }
        payload = {
            "comment": "",
            "environmentKey": env_key,
            "instructions": [
                {"kind": "turnFlagOn"},
                self._build_start_automated_release_instruction(
                    control_var,
                    test_var,
                    stages or self._default_automated_release_stages(stagesWindow),
                    release_kind="guarded",
                    metrics=metrics,
                    rollback=rollback,
                ),
            ],
        }
        res = self.getrequest("PATCH", url, headers=headers, json=payload)
        return res

    ##################################################
    # Stop an automated release on a flag
    ##################################################
    def stop_automated_release(
        self, flag_key, env_key, final_variation_id, rule_id=None, comment=""
    ):
        url = (
            "https://app.launchdarkly.com/api/v2/flags/"
            + self.project_key
            + "/"
            + flag_key
            + "?ignoreConflicts=true"
        )
        headers = {
            "Authorization": self.api_key,
            "Content-Type": "application/json; domain-model=launchdarkly.semanticpatch",
        }
        payload = {
            "comment": comment,
            "environmentKey": env_key,
            "instructions": [
                self._build_stop_automated_release_instruction(
                    final_variation_id, rule_id
                )
            ],
        }
        return self.getrequest("PATCH", url, headers=headers, json=payload)

    ##################################################
    # Add a progressive rollout to a flag
    ##################################################
    def add_progressive_rollout(
        self,
        flag_key,
        env_key,
        timeout=604800000,
        rollback=True,
        weight=50000,
        notify=True,
    ):
        vars, defaults = self.get_flag_variation_values(flag_key)

        control_var = ""
        end_var = ""

        # Since this is likely going to be added immediately after
        # creating a flag, we're going to sleep for 2 seconds. Otherwise
        # adding the rollout doesn't consistently take.
        time.sleep(2)

        for v in vars:
            if v["value"] == False:
                control_var = v["id"]
            else:
                end_var = v["id"]

        url = (
            "https://app.launchdarkly.com/api/v2/flags/"
            + self.project_key
            + "/"
            + flag_key
            + "?ignoreConflicts=true"
        )
        headers = {
            "Authorization": self.api_key,
            "Content-Type": "application/json; domain-model=launchdarkly.semanticpatch",
        }
        payload = {
            "comment": "",
            "environmentKey": env_key,
            "instructions": [
                {"kind": "turnFlagOn"},
                self._build_start_automated_release_instruction(
                    control_var,
                    end_var,
                    self._default_automated_release_stages(timeout),
                    release_kind="progressive",
                ),
            ],
        }
        res = self.getrequest("PATCH", url, headers=headers, json=payload)
        return res

    ##################################################
    # Stop a progressive rollout on a flag
    ##################################################
    def stop_progressive_rollout(
        self, flag_key, env_key, final_variation_id, rule_id=None, comment=""
    ):
        return self.stop_automated_release(
            flag_key, env_key, final_variation_id, rule_id, comment
        )

    ##################################################
    # Toggle flag state
    ##################################################
    def toggle_flag(self, flag_key, flag_state, flag_env, comment=None):
        cmd = ""
        if flag_state == "on":
            cmd = "turnFlagOn"
        else:
            cmd = "turnFlagOff"

        url = (
            "https://app.launchdarkly.com/api/v2/flags/"
            + self.project_key
            + "/"
            + flag_key
        )
        headers = {
            "Authorization": self.api_key,
            "Content-Type": "application/json; domain-model=launchdarkly.semanticpatch",
        }
        payload = {"environmentKey": flag_env, "instructions": [{"kind": cmd}]}
        if comment is not None:
            payload["comment"] = comment

        res = self.getrequest("PATCH", url, headers=headers, json=payload)

        # Check semantic patch result; only fall back to a JSON Patch if it failed
        semantic_ok = 200 <= res.status_code < 300
        try:
            data = json.loads(res.text)
            if "message" in data:
                semantic_ok = False
                print(f"  [toggle_flag] Semantic patch for {flag_key}: {data['message']}")
        except (json.JSONDecodeError, AttributeError):
            print(f"  [toggle_flag] Semantic patch for {flag_key}: status {res.status_code}")

        if not semantic_ok:
            # Fallback: JSON Patch to directly set on/off state
            on_value = flag_state == "on"
            json_patch_headers = {
                "Authorization": self.api_key,
                "Content-Type": "application/json",
            }
            json_patch_payload = [
                {"op": "replace", "path": "/environments/" + flag_env + "/on", "value": on_value}
            ]
            res2 = self.getrequest("PATCH", url, headers=json_patch_headers, json=json_patch_payload)
            try:
                data2 = json.loads(res2.text)
                if "message" in data2:
                    print(f"  [toggle_flag] JSON patch for {flag_key}: {data2['message']}")
            except (json.JSONDecodeError, AttributeError):
                print(f"  [toggle_flag] JSON patch for {flag_key}: status {res2.status_code}")

        return res

    ##################################################
    # Add a maintainerId to flag
    ##################################################

    def add_maintainer_to_flag(self, flag_key):
        url = (
            "https://app.launchdarkly.com/api/v2/flags/"
            + self.project_key
            + "/"
            + flag_key
        )
        headers = {
            "Authorization": self.api_key,
            "Content-Type": "application/json",
        }
        payload = [
            {
                "op": "replace",
                "path": "/maintainerId",
                "value": self.user_id,
            }
        ]

        res = self.getrequest("PATCH", url, headers=headers, json=payload)
        return res

    ##################################################
    # Add a maintainerId to metric
    ##################################################

    def add_maintainer_to_metric(self, metric_key):
        url = (
            "https://app.launchdarkly.com/api/v2/metrics/"
            + self.project_key
            + "/"
            + metric_key
        )
        headers = {
            "Authorization": self.api_key,
            "Content-Type": "application/json",
        }
        payload = [
            {
                "op": "replace",
                "path": "/maintainerId",
                "value": self.user_id,
            }
        ]

        res = self.getrequest("PATCH", url, headers=headers, json=payload)
        return res

    ##################################################
    # Add segment to flag
    ##################################################

    def add_segment_to_flag(self, flag_key, segment_key, env_key, variation=True, segment=False):
        url = (
            "https://app.launchdarkly.com/api/v2/flags/"
            + self.project_key
            + "/"
            + flag_key
        )
        headers = {
            "Authorization": self.api_key,
            "Content-Type": "application/json; domain-model=launchdarkly.semanticpatch",
        }
        var_id = self.get_flag_variations(flag_key, None, segment)[0]
        payload = {
            "environmentKey": env_key,
            "instructions": [
                {
                    "kind": "addRule",
                    "variationId": var_id,
                    "clauses": [
                        {
                            "contextKind": "",
                            "attribute": "segmentMatch",
                            "op": "segmentMatch",
                            "negate": False,
                            "values": [segment_key],
                        }
                    ],
                }
            ],
        }

        res = self.getrequest("PATCH", url, headers=headers, json=payload)
        return res

    ##################################################
    # Add a targeting rule serving a chosen variation
    ##################################################

    def add_rule_to_flag(self, flag_key, env_key, clauses, variation_value, description=""):
        """Append a rule to the flag's targeting, after any already there.

        add_segment_to_flag always serves the first variation, which suits an
        on/off release and nothing with more than two outcomes. This serves
        the variation whose value is variation_value, and takes its clauses as
        [context_kind, attribute, op, values] lists, the same shape SEGMENTS
        uses. A segment clause is ['', 'segmentMatch', 'segmentMatch', [keys]].
        All clauses must match; the values within one clause are any-of.
        """
        variations = self.get_flag_variation_values(flag_key)[0]
        var_id = next(
            (
                v["id"]
                for v in variations
                if type(v["value"]) is type(variation_value)
                and v["value"] == variation_value
            ),
            None,
        )
        if var_id is None:
            print(f"Error: {flag_key} has no variation with value {variation_value!r}")
            return None

        url = (
            "https://app.launchdarkly.com/api/v2/flags/"
            + self.project_key
            + "/"
            + flag_key
        )
        headers = {
            "Authorization": self.api_key,
            "Content-Type": "application/json; domain-model=launchdarkly.semanticpatch",
        }
        payload = {
            "environmentKey": env_key,
            "instructions": [
                {
                    "kind": "addRule",
                    "variationId": var_id,
                    "description": description,
                    "clauses": [
                        {
                            "contextKind": context_kind,
                            "attribute": attribute,
                            "op": op,
                            "negate": False,
                            "values": values,
                        }
                        for context_kind, attribute, op, values in clauses
                    ],
                }
            ],
        }

        res = self.getrequest("PATCH", url, headers=headers, json=payload)
        if res.status_code >= 400:
            print(
                f"  [add_rule_to_flag] {flag_key}: HTTP "
                f"{res.status_code} {res.text[:300]}"
            )
        return res

    ##################################################
    # Add prequisite to flag
    ##################################################

    def add_prerequisite_to_flag(self, flag_key, prerequisite_key, var_id, env_key):
        varids = self.get_flag_variations(prerequisite_key)
        if not varids:
            print(
                f"  [add_prerequisite_to_flag] {flag_key}: prerequisite "
                f"{prerequisite_key} has no variations, cannot add prereq"
            )
            return None

        url = (
            "https://app.launchdarkly.com/api/v2/flags/"
            + self.project_key
            + "/"
            + flag_key
        )
        headers = {
            "Authorization": self.api_key,
            "Content-Type": "application/json; domain-model=launchdarkly.semanticpatch",
        }
        payload = {
            "environmentKey": env_key,
            "instructions": [
                {
                    "kind": "addPrerequisite",
                    "key": prerequisite_key,
                    "variationId": varids[var_id],
                }
            ],
        }

        res = self.getrequest("PATCH", url, headers=headers, json=payload)
        if res.status_code >= 400:
            print(
                f"  [add_prerequisite_to_flag] {flag_key} <- {prerequisite_key}: "
                f"HTTP {res.status_code} {res.text[:300]}"
            )
        return res

    ##################################################
    # Set default rule to a manual percentage rollout
    ##################################################
    def set_default_percentage_rollout(
        self,
        flag_key,
        env_key,
        weights=None,
        rollout_context_kind="user",
        rollout_bucket_by="key",
    ):
        """Set a flag's fallthrough to a manual percentage rollout.

        weights maps variation value (True/False, or ordinal int) to weight
        in thousandths (0-100000). Defaults to an even split across all
        variations if omitted.
        """
        # Newly-created flags need a beat before they'll accept a PATCH.
        time.sleep(2)

        vars = self.get_flag_variation_values(flag_key)[0]
        if not vars:
            print(f"Error: no variations found for {flag_key}, cannot set rollout")
            return None

        default_weights = {}
        if weights is None:
            share = 100000 // len(vars)
            remainder = 100000 - (share * len(vars))
            for i, v in enumerate(vars):
                default_weights[v["id"]] = share + (remainder if i == 0 else 0)
        else:
            for key, weight in weights.items():
                matched = None
                for v in vars:
                    # Strict type match on value first: True == 1 in Python
                    # so a loose == would misroute bool keys via ordinal.
                    if type(v["value"]) is type(key) and v["value"] == key:
                        matched = v["id"]
                        break
                if matched is None and isinstance(key, int) and not isinstance(key, bool):
                    for v in vars:
                        if v["ordinal"] == key:
                            matched = v["id"]
                            break
                if matched is None:
                    print(
                        f"Warning: could not match rollout key {key!r} to a "
                        f"variation on {flag_key}"
                    )
                    continue
                default_weights[matched] = weight

        url = (
            "https://app.launchdarkly.com/api/v2/flags/"
            + self.project_key
            + "/"
            + flag_key
        )
        headers = {
            "Authorization": self.api_key,
            "Content-Type": "application/json; domain-model=launchdarkly.semanticpatch",
        }
        payload = {
            "environmentKey": env_key,
            "instructions": [
                {
                    "kind": "updateFallthroughVariationOrRollout",
                    "rolloutContextKind": rollout_context_kind,
                    "rolloutBucketBy": rollout_bucket_by,
                    "rolloutWeights": default_weights,
                },
            ],
        }

        res = self.getrequest("PATCH", url, headers=headers, json=payload)
        if res.status_code >= 400:
            print(
                f"  [set_default_percentage_rollout] {flag_key}: HTTP "
                f"{res.status_code} {res.text[:300]}"
            )
        return res

    ##################################################
    # Create a flag trigger (generic webhook)
    ##################################################
    def create_flag_trigger(self, flag_key, env_key, action="turnFlagOff", comment=None):
        """Create a generic webhook trigger on a flag.

        action must be 'turnFlagOn' or 'turnFlagOff'. Returns the parsed
        JSON response, which includes the trigger URL under `triggerURL`.
        """
        if action not in ("turnFlagOn", "turnFlagOff"):
            raise ValueError(
                f"action must be turnFlagOn or turnFlagOff, got {action!r}"
            )

        url = (
            "https://app.launchdarkly.com/api/v2/flags/"
            + self.project_key
            + "/"
            + flag_key
            + "/triggers/"
            + env_key
        )
        headers = {
            "Authorization": self.api_key,
            "Content-Type": "application/json",
        }
        payload = {
            "integrationKey": "generic-trigger",
            "instructions": [{"kind": action}],
        }
        if comment:
            payload["comment"] = comment

        res = self.getrequest("POST", url, headers=headers, json=payload)
        # Trigger URLs are secrets and only visible at creation time. We intentionally
        # do NOT print them to stdout so they don't leak into GitHub Actions logs.
        # Retrieve a URL by resetting the trigger in the LD UI when needed.
        if res.status_code >= 400:
            print(f"  [create_flag_trigger] {flag_key} ({action}): HTTP {res.status_code} {res.text[:300]}")
        else:
            print(f"  Trigger created: {flag_key} ({action})")
        return res

    ##################################################
    # Start experiment iteration
    ##################################################
    def start_exp_iteration(self, exp_key, exp_env):
        url = (
            "https://app.launchdarkly.com/api/v2/projects/"
            + self.project_key
            + "/environments/"
            + exp_env
            + "/experiments/"
            + exp_key
        )

        headers = {
            "Authorization": self.api_key,
            "Content-Type": "application/json",
            "LD-API-Version": "beta",
        }
        payload = {
            "instructions": [
                {
                    "kind": "startIteration",
                    "changeJustification": "Time to start the experiment!",
                }
            ]
        }

        res = self.getrequest("PATCH", url, headers=headers, json=payload)
        return res

    ##################################################
    # Add a flag to a pipeline
    ##################################################
    def add_pipeline_flag(self, flag_key, pipeline_key):
        var_ids = self.get_flag_variations(flag_key)
        if not var_ids:
            print(f"Warning: No variations found for flag {flag_key}, skipping pipeline addition")
            return None
        var_id = var_ids[0]
        url = (
            "https://app.launchdarkly.com/api/v2/projects/"
            + self.project_key
            + "/flags/"
            + flag_key
            + "/release"
        )

        headers = {
            "Content-Type": "application/json",
            "Authorization": self.api_key,
            "LD-API-Version": "beta",
        }

        payload = {
            "releaseVariationId": var_id,
            "releasePipelineKey": pipeline_key,
        }

        response = self.getrequest("PUT", url, json=payload, headers=headers)
        return response

    ##################################################
    # Get pipeline phase IDs
    ##################################################
    def get_pipeline_phase_ids(self, pipeline_key):
        # Phase IDs are fixed once a pipeline is created — cache them
        if pipeline_key in self._pipeline_phase_cache:
            return self._pipeline_phase_cache[pipeline_key]
        url = (
            "https://app.launchdarkly.com/api/v2/projects/"
            + self.project_key
            + "/release-pipelines/"
            + pipeline_key
        )
        res = self.getrequest(
            "GET",
            url,
            headers={
                "Content-Type": "application/json",
                "Authorization": self.api_key,
                "LD-API-Version": "beta",
            },
        )
        if not res.text.strip():
            print(f"get_pipeline_phase_ids: empty response (status {res.status_code})")
            return {}
        try:
            data = json.loads(res.text)
        except json.JSONDecodeError:
            print(f"get_pipeline_phase_ids: non-JSON response (status {res.status_code})")
            return {}
        if "phases" not in data:
            msg = data.get("message", "no 'phases' key in response")
            print(f"get_pipeline_phase_ids: {msg}")
            return {}
        c = 0
        phases = ["test", "guard", "ga"]
        phase_ids = {}
        for p in data["phases"]:
            id = p["id"]
            phase_ids.update({phases[c]: id})
            c += 1
        if phase_ids:
            self._pipeline_phase_cache[pipeline_key] = phase_ids
        return phase_ids

    ##################################################
    # Attach a metric to a flag
    ##################################################
    def attach_metric_to_flag(self, flag_key, metric_keys=[]):
        url = (
            "https://app.launchdarkly.com/api/v2/projects/"
            + self.project_key
            + "/flags/"
            + flag_key
            + "/measured-rollout-configuration"
        )

        headers = {
            "Content-Type": "application/json",
            "Authorization": self.api_key,
            "LD-API-Version": "beta",
        }

        payload = {"metricKeys": metric_keys}

        response = self.getrequest("PUT", url, json=payload, headers=headers)
        return response

    ##################################################
    # Advance a flag to the next phase
    ##################################################
    def advance_flag_phase(self, flag_key, status, pipeline_phase_id, guarded=False):
        counter = 0
        status_code = 0
        payload = {}
        while status_code != 200:
            counter += 1
            url = (
                "https://app.launchdarkly.com/api/v2/projects/"
                + self.project_key
                + "/flags/"
                + flag_key
                + "/release/phases/"
                + pipeline_phase_id
            )
            
            if guarded == True:
                payload = {
                    "status": status,
                    "audiences": [
						{
							"audienceId": str(uuid.uuid4()),
							"releaseGuardianConfiguration": {
								"randomizationUnit": "user"
							}
						}
					]
                }
                
            else:
                payload = {
                    "status": status,
                }
    
            headers = {
                "Content-Type": "application/json",
                "Authorization": self.api_key,
                "LD-API-Version": "beta",
            }

            response = self.getrequest("PUT", url, json=payload, headers=headers)
            status_code = response.status_code
            if counter > 8:
                break
            if status_code != 200:
                try:
                    data = json.loads(response.text)
                    msg = data.get("message", "")
                except Exception:
                    msg = response.text or ""
                if "Phase must have status" in msg or "ReadyToStart" in msg:
                    print("Warning: Skipping phase advance (phase not in ReadyToStart/Active): " + msg[:80])
                    break
                print("Error advancing flag phase: " + msg)
                time.sleep(3)

        return response
    
    ##################################################
    # Update AI Config Targeting
    ##################################################
    def update_ai_config_targeting(self, ai_config_key, environment_key, variation_id):
        url = (
            "https://app.launchdarkly.com/api/v2/projects/"
            + self.project_key
            + "/ai-configs/"
            + ai_config_key
            + "/targeting"
        )
        
        headers = {
            "Content-Type": "application/json",
            "Authorization": self.api_key,
            "LD-API-Version": "beta",
        }
        
        payload = {
            "environmentKey": environment_key,
            "instructions": [
                {
                    "kind": "updateFallthroughVariationOrRollout",
                    "variationId": variation_id
                }
            ]
        }
        
        response = self.getrequest("PATCH", url, headers=headers, json=payload)
        data = json.loads(response.text)
        if "message" in data:
            print("Error updating AI config targeting: " + data["message"])
        return response
    
    ##################################################
    # Add targeting rule to AI Config
    ##################################################
    def update_ai_config_targeting_add_rule(self, ai_config_key, environment_key, variation_id, clauses):
        url = (
            "https://app.launchdarkly.com/api/v2/projects/"
            + self.project_key
            + "/ai-configs/"
            + ai_config_key
            + "/targeting"
        )
        headers = {
            "Content-Type": "application/json; domain-model=launchdarkly.semanticpatch",
            "Authorization": self.api_key,
            "LD-API-Version": "beta",
        }
        payload = {
            "environmentKey": environment_key,
            "instructions": [
                {
                    "kind": "addRule",
                    "variationId": variation_id,
                    "clauses": clauses
                }
            ]
        }
        response = self.getrequest("PATCH", url, headers=headers, json=payload)
        try:
            data = json.loads(response.text)
            if "message" in data:
                print(f"Error adding targeting rule to {ai_config_key}: {data['message']}")
        except json.JSONDecodeError:
            pass
        return response

    ##################################################
    # Toggle AI Config
    ##################################################
    def toggle_ai_config(self, ai_config_key, environment_key, state="on"):
        url = (
            "https://app.launchdarkly.com/api/v2/projects/"
            + self.project_key
            + "/ai-configs/"
            + ai_config_key
            + "/targeting"
        )
        
        headers = {
            "Content-Type": "application/json",
            "Authorization": self.api_key,
            "LD-API-Version": "beta",
        }
        
        instruction_kind = "turnConfigOn" if state == "on" else "turnConfigOff"
        
        payload = {
            "environmentKey": environment_key,
            "instructions": [
                {
                    "kind": instruction_kind
                }
            ]
        }
        
        response = self.getrequest("PATCH", url, headers=headers, json=payload)
        data = json.loads(response.text)
        if "message" in data:
            print("Error toggling AI config: " + data["message"])
        return response
    
    ##################################################
    # Fetch an AI Config's JSON, with caching
    ##################################################
    def _get_ai_config_json(self, ai_config_key):
        """Fetch (and cache) an AI Config's JSON. The cache is invalidated
        whenever this run writes to the config's variations."""
        if ai_config_key in self._ai_config_cache:
            return self._ai_config_cache[ai_config_key]

        url = (
            "https://app.launchdarkly.com/api/v2/projects/"
            + self.project_key
            + "/ai-configs/"
            + ai_config_key
        )
        headers = {
            "Content-Type": "application/json",
            "Authorization": self.api_key,
            "LD-API-Version": "beta",
        }
        response = self.getrequest("GET", url, headers=headers)
        data = json.loads(response.text)
        if "message" in data:
            print("Error getting AI config: " + data["message"])
            return None
        self._ai_config_cache[ai_config_key] = data
        return data

    ##################################################
    # Get AI Config Variation ID
    ##################################################
    def get_ai_config_targeting_variation_id(self, ai_config_key, variation_key):
        # The ID targeting knows a variation by. get_ai_config_variation_id
        # returns the ID of the variation's latest version instead, which only
        # matches until the variation is first edited.
        res = self.getrequest(
            "GET",
            "https://app.launchdarkly.com/api/v2/projects/"
            + self.project_key
            + "/ai-configs/"
            + ai_config_key
            + "/targeting",
            headers={"Authorization": self.api_key, "LD-API-Version": "beta"},
        )
        try:
            variations = json.loads(res.text).get("variations", [])
        except (json.JSONDecodeError, AttributeError):
            variations = []
        for variation in variations:
            meta = variation.get("value", {}).get("_ldMeta", {})
            if meta.get("variationKey") == variation_key:
                return variation["_id"]
        print(f"Targeting variation with key '{variation_key}' not found")
        return None

    def get_ai_config_variation_id(self, ai_config_key, variation_key):
        # Seeded by create_ai_config_versions / create_ai_agent_variation,
        # so most lookups need no API call at all
        cached_id = self._ai_variation_ids.get((ai_config_key, variation_key))
        if cached_id:
            return cached_id

        data = self._get_ai_config_json(ai_config_key)
        if data is None:
            return None

        # Find the variation with the matching key (and seed the ID map)
        result = None
        for variation in data.get("variations", []):
            var_key = variation.get("key")
            var_id = variation.get("_id")
            if var_key and var_id:
                self._ai_variation_ids[(ai_config_key, var_key)] = var_id
            if var_key == variation_key:
                result = var_id

        if result is None:
            print(f"Variation with key '{variation_key}' not found")
        return result

    ##################################################
    # Create Agent Graph
    ##################################################
    def create_agent_graph(self, graph_key, graph_name, description, edges, root_config_key=None):
        url = (
            "https://app.launchdarkly.com/api/v2/projects/"
            + self.project_key
            + "/agent-graphs"
        )

        payload = {
            "key": graph_key,
            "name": graph_name,
            "description": description,
            "edges": edges,
        }
        if root_config_key:
            payload["rootConfigKey"] = root_config_key

        if self.user_id:
            payload["maintainerId"] = self.user_id

        headers = {
            "Content-Type": "application/json",
            "Authorization": self.api_key,
            "LD-API-Version": "beta",
        }

        response = self.getrequest("POST", url, json=payload, headers=headers)
        try:
            data = json.loads(response.text)
            if "message" in data:
                print("Error creating agent graph: " + data["message"])
        except json.JSONDecodeError:
            print(f"Agent graph creation response status: {response.status_code}")
        return response

    ##################################################
    # Create AI Fallback Segment
    ##################################################
    def create_ai_fallback_segment(self, env_key):
        segment_key = "ai-fallback"
        segment_name = "AI Fallback"
        description = "Segment for AI contexts with fallback enabled - used for self-healing AI model switching"
        
        res = self.create_segment(segment_key, segment_name, env_key, description)
        
        res = self.add_segment_rule(
            segment_key,
            env_key,
            "ai",
            "fallback",
            "in",
            [True]
        )
        
        return res
    
    ##################################################
    #adding AI fallback targeting
    ##################################################
    def add_ai_fallback_targeting_to_ai_config(self, ai_config_key, env_key, fallback_variation_key):
        variation_id = self.get_ai_config_variation_id(ai_config_key, fallback_variation_key)
        
        if not variation_id:
            print(f"Error: Could not find variation '{fallback_variation_key}' for AI config '{ai_config_key}'")
            return None
        
        url = (
            "https://app.launchdarkly.com/api/v2/projects/"
            + self.project_key
            + "/ai-configs/"
            + ai_config_key
            + "/targeting"
        )
        
        headers = {
            "Content-Type": "application/json",
            "Authorization": self.api_key,
            "LD-API-Version": "beta",
        }
        
        payload = {
            "environmentKey": env_key,
            "instructions": [
                {
                    "kind": "addRule",
                    "variationId": variation_id,
                    "clauses": [
                        {
                            "contextKind": "",
                            "attribute": "segmentMatch",
                            "op": "segmentMatch",
                            "negate": False,
                            "values": ["ai-fallback"]
                        }
                    ]
                }
            ]
        }
        
        response = self.getrequest("PATCH", url, headers=headers, json=payload)
        
        if response.text.strip():
            try:
                data = json.loads(response.text)
                if "message" in data:
                    print("Error adding AI fallback targeting: " + data["message"])
                else:
                    print(f"Successfully added AI fallback targeting to {ai_config_key}")
            except json.JSONDecodeError as e:
                print(f"JSON decode error: {e}")
                print(f"Response status: {response.status_code}")
        
        return response

    ##################################################
    # Add guarded rollout to AI Agent
    ##################################################
    def add_ai_agent_guarded_rollout(
        self,
        ai_config_key,
        env_key,
        metrics=[],
        timeout=600000,  # 10 minutes in milliseconds
        rollback=True,
        weight=50000,
        notify=True,
        days=1,
        control_key=None,
        target_key=None,
        stages=None,
    ):
        # control_key and target_key name the variations to roll out from
        # and to; without them it falls back to list order, which the API does
        # not promise. stages overrides the days presets, as in
        # add_guarded_rollout.
        # Since this is likely going to be added immediately after
        # creating an AI config, we're going to sleep for 2 seconds. Otherwise
        # adding the guarded rollout doesn't consistently take.
        time.sleep(2)
        
        # Get AI config variations (excluding disabled)
        variations = self.get_ai_config_variations(ai_config_key)
        
        if len(variations) < 2:
            print(f"Error: AI config {ai_config_key} needs at least 2 variations for guarded rollout")
            return None
        
        if control_key and target_key:
            control_var = self.get_ai_config_targeting_variation_id(ai_config_key, control_key)
            test_var = self.get_ai_config_targeting_variation_id(ai_config_key, target_key)
            if not control_var or not test_var:
                return None
        else:
            # Use first two variations (excluding disabled)
            control_var = variations[1]["_id"]
            test_var = variations[0]["_id"]
        
        # Calculate stages window based on days
        stages_window = 120000  # 2 minutes default
        if days == 7:
            stages_window = 120960000  # 7 days
        elif days == 1:
            stages_window = 720000  # 12 minutes for 1 day
        
        url = (
            "https://app.launchdarkly.com/api/v2/projects/"
            + self.project_key
            + "/ai-configs/"
            + ai_config_key
            + "/targeting"
        )
        
        headers = {
            "Authorization": self.api_key,
            "Content-Type": "application/json; domain-model=launchdarkly.semanticpatch",
            "LD-API-Version": "beta",
        }
        
        payload = {
            "comment": f"Guarded rollout for AI Agent {ai_config_key}",
            "environmentKey": env_key,
            "instructions": [
                self._build_start_automated_release_instruction(
                    control_var,
                    test_var,
                    stages or self._default_automated_release_stages(stages_window),
                    release_kind="guarded",
                    metrics=metrics,
                    rollback=rollback,
                ),
            ],
        }
        
        response = self.getrequest("PATCH", url, headers=headers, json=payload)
        
        # Add better error handling for JSON parsing
        if response.text.strip():
            try:
                data = json.loads(response.text)
                if "message" in data:
                    print("Error adding AI agent guarded rollout: " + data["message"])
            except json.JSONDecodeError as e:
                print(f"JSON decode error: {e}")
                print(f"Response status: {response.status_code}")
                print(f"Response text: {response.text[:500]}...")
        else:
            print("Empty response received from AI agent guarded rollout API")
            
        return response
    
    ##################################################
    # Get AI Config Variations (excluding disabled)
    ##################################################
    def get_ai_config_variations(self, ai_config_key):
        data = self._get_ai_config_json(ai_config_key)
        if data is None:
            return []

        # Filter out disabled variations
        variations = []
        for variation in data.get("variations", []):
            if variation.get("name", "").lower() != "disabled":
                variations.append(variation)
        
        return variations
    
    ##################################################
    # Observability alerts
    ##################################################
    #
    # There is no public REST endpoint for alerts. The LaunchDarkly UI and the
    # LaunchDarkly MCP servers both create them with the createAlert mutation
    # on the observability backend's GraphQL API, which takes an ordinary API
    # access token as Gonfalon-Authorization and the LD project's _id as the
    # observability project. It is an internal API, so a field could change.

    O11Y_GRAPHQL_URL = "https://pri.observability.app.launchdarkly.com"

    CREATE_ALERT_MUTATION = """
mutation CreateAlert(
  $project_id: StringID!
  $name: String!
  $product_type: ProductType!
  $function_type: MetricAggregator!
  $query: String
  $threshold_value: Float
  $threshold_window: Int
  $threshold_cooldown: Int
  $threshold_type: ThresholdType
  $threshold_condition: ThresholdCondition
  $destinations: [AlertDestinationInput!]!
) {
  createAlert(
    project_id: $project_id
    name: $name
    product_type: $product_type
    function_type: $function_type
    query: $query
    threshold_value: $threshold_value
    threshold_window: $threshold_window
    threshold_cooldown: $threshold_cooldown
    threshold_type: $threshold_type
    threshold_condition: $threshold_condition
    destinations: $destinations
  ) {
    id
  }
}"""

    DELETE_ALERT_MUTATION = """
mutation DeleteAlert($project_id: StringID!, $alert_id: ID!) {
  deleteAlert(project_id: $project_id, alert_id: $alert_id)
}"""

    # A project made seconds ago may not be open to alerts yet, so a refused
    # createAlert is retried a few times before giving up.
    ALERT_CREATE_ATTEMPTS = 4
    ALERT_RETRY_DELAY = 10.0

    # How long create_trigger_alert waits for the alert's creation notice to
    # reach the flag trigger before moving on.
    TRIGGER_PING_TIMEOUT = 90.0

    def _o11y_graphql(self, query, variables, secrets=()):
        """POST one operation to the observability GraphQL API.

        Returns (data, errors). Error text has every value in `secrets`
        replaced, because a validation message can echo an input back, and
        a webhook destination is a trigger URL.
        """
        res = self.getrequest(
            "POST",
            self.O11Y_GRAPHQL_URL,
            json={"query": query, "variables": variables},
            headers={
                "Content-Type": "application/json",
                "Gonfalon-Authorization": self.api_key,
                "x-project-id": self.project_internal_id,
            },
        )

        def scrub(text):
            for secret in secrets:
                if secret:
                    text = text.replace(secret, "***")
            return text

        if res.status_code != 200:
            return None, [scrub(f"HTTP {res.status_code} {res.text[:300]}")]
        body = self._parse_json_response(res, context="observability GraphQL")
        errors = [scrub(str(e.get("message"))) for e in body.get("errors") or []]
        return body.get("data"), errors

    def create_alert(
        self,
        alert_name,
        product_type,
        query,
        threshold_value,
        threshold_window,
        threshold_cooldown=None,
        function_type="Count",
        destinations=None,
    ):
        """Create a constant-threshold observability alert. Returns its ID, or None.

        Fires when the `function_type` of matching records over the last
        `threshold_window` seconds is above `threshold_value`. Each destination
        is {"destination_type", "type_id", "type_name"}; for a Webhook, type_id
        is the URL, which is never printed.
        """
        destinations = destinations or []
        variables = {
            "project_id": self.project_internal_id,
            "name": alert_name,
            "product_type": product_type,
            "function_type": function_type,
            "query": query,
            "threshold_value": threshold_value,
            "threshold_window": threshold_window,
            "threshold_cooldown": threshold_cooldown or threshold_window,
            "threshold_type": "Constant",
            "threshold_condition": "Above",
            "destinations": destinations,
        }
        secrets = [d["type_id"] for d in destinations]

        for attempt in range(1, self.ALERT_CREATE_ATTEMPTS + 1):
            data, errors = self._o11y_graphql(self.CREATE_ALERT_MUTATION, variables, secrets)
            alert = (data or {}).get("createAlert")
            if alert and alert.get("id"):
                print(f"  Alert created: {alert_name}")
                return str(alert["id"])
            if attempt < self.ALERT_CREATE_ATTEMPTS:
                time.sleep(self.ALERT_RETRY_DELAY)

        print(f"  Error creating alert {alert_name}: {'; '.join(errors) or 'no alert returned'}")
        return None

    def delete_alert(self, alert_id):
        data, errors = self._o11y_graphql(
            self.DELETE_ALERT_MUTATION,
            {"project_id": self.project_internal_id, "alert_id": alert_id},
        )
        if errors or not (data or {}).get("deleteAlert"):
            print(f"  Error deleting alert {alert_id}: {'; '.join(errors) or 'not deleted'}")

    def _flag_trigger_count(self, flag_key, env_key, trigger_id):
        res = self.getrequest(
            "GET",
            f"https://app.launchdarkly.com/api/v2/flags/{self.project_key}/{flag_key}"
            f"/triggers/{env_key}/{trigger_id}",
            headers={"Authorization": self.api_key},
        )
        if res.status_code != 200:
            return 0
        return self._parse_json_response(res, context="flag trigger").get("_triggerCount") or 0

    def create_trigger_alert(
        self,
        flag_key,
        env_key,
        action,
        alert_name,
        product_type,
        query,
        threshold_value,
        threshold_window,
        threshold_cooldown=None,
        trigger_comment=None,
    ):
        """Create a flag trigger and an alert whose webhook calls it.

        The trigger URL is a secret, shown once in the create response; it
        goes straight into the alert's destination and is never printed.

        Creating an alert sends an ALERT_CREATED notice to its destinations,
        so the trigger fires once at setup. This waits for that call to land,
        then returns, leaving the flag in whatever state the trigger put it:
        the caller sets the resting state afterwards (a toggle_flag post step).
        """
        res = self.create_flag_trigger(flag_key, env_key, action=action, comment=trigger_comment)
        if res.status_code >= 400:
            return None
        trigger = self._parse_json_response(res, context=f"create_flag_trigger {flag_key}")
        trigger_url = trigger.get("triggerURL")
        trigger_id = trigger.get("_id")
        if not trigger_url or not trigger_id:
            print(f"  Error: trigger for {flag_key} came back without its URL or ID")
            return None

        alert_id = self.create_alert(
            alert_name,
            product_type,
            query,
            threshold_value,
            threshold_window,
            threshold_cooldown=threshold_cooldown,
            destinations=[{
                "destination_type": "Webhook",
                "type_id": trigger_url,
                "type_name": f"{flag_key} trigger",
            }],
        )
        if alert_id is None:
            return None

        deadline = time.time() + self.TRIGGER_PING_TIMEOUT
        while self._flag_trigger_count(flag_key, env_key, trigger_id) < 1:
            if time.time() > deadline:
                print(f"  Warning: the alert's setup notice never reached {flag_key}'s trigger. "
                      f"If it arrives late it will flip the flag, so check {flag_key} is in "
                      f"its resting state.")
                break
            time.sleep(2)
        return alert_id

    def create_adaptive_trigger(
        self,
        flag_key,
        env_key,
        serve_value,
        alert_name,
        product_type,
        query,
        threshold_value,
        threshold_window,
        threshold_cooldown=None,
        resource_kind="flag",
    ):
        """Create an alert and an adaptive trigger that serves `serve_value` when it fires.

        The trigger acts on the default rule. `query` may contain
        {environment_id}, filled with the environment's _id, which is how
        LaunchDarkly custom events are scoped in observability. Mirrors the
        LaunchDarkly UI: if the trigger cannot be created, the alert is
        deleted rather than left behind.

        For an AI Config, `resource_kind` is "ai-config" and `serve_value` is
        a variation key: an AI Config is a flag underneath, whose variation
        values are objects that carry their key in _ldMeta.
        """
        headers = {"Authorization": self.api_key, "Content-Type": "application/json"}
        base = f"https://app.launchdarkly.com/api/v2/projects/{self.project_key}/environments/{env_key}"

        res = self.getrequest("GET", base, headers=headers)
        if res.status_code != 200:
            print(f"  Error: could not read environment {env_key}: HTTP {res.status_code}")
            return None
        environment_id = self._parse_json_response(res, context=f"environment {env_key}").get("_id")

        flag = self._get_flag_json(flag_key) or {}
        variation_id = next(
            (v["_id"] for v in flag.get("variations", [])
             if v.get("value") == serve_value
             or (isinstance(v.get("value"), dict)
                 and v["value"].get("_ldMeta", {}).get("variationKey") == serve_value)),
            None,
        )
        if variation_id is None:
            print(f"  Error: {flag_key} has no variation with value {serve_value!r}")
            return None

        alert_id = self.create_alert(
            alert_name,
            product_type,
            query.format(environment_id=environment_id),
            threshold_value,
            threshold_window,
            threshold_cooldown=threshold_cooldown,
        )
        if alert_id is None:
            return None

        res = self.getrequest(
            "POST",
            base + "/adaptive-triggers",
            headers=headers,
            json={
                "name": alert_name,
                "resourceKind": resource_kind,
                "resourceKey": flag_key,
                "triggerSource": {"type": "observabilityAlert", "alertId": int(alert_id)},
                "task": {"instructions": [{
                    "kind": "updateFallthroughVariationOrRollout",
                    "variationId": variation_id,
                }]},
            },
        )
        if res.status_code not in (200, 201):
            print(f"  Error creating adaptive trigger on {flag_key}: HTTP {res.status_code} {res.text[:300]}")
            self.delete_alert(alert_id)
            return None
        print(f"  Adaptive trigger created: {flag_key} (serves {serve_value})")
        return alert_id

    ##################################################
    # Agent Optimization API methods
    ##################################################

    def create_agent_optimization(self, key, ai_config_key, max_attempts, judge_model,
                                   model_choices=None, acceptance_statements=None,
                                   judges=None, user_input_options=None,
                                   ground_truth_responses=None, metric_key=None,
                                   token_limit=None, variable_choices=None,
                                   latency_optimization=None, token_optimization=None,
                                   auto_commit=None):
        """Create an agent optimization config via POST /api/v2/projects/{projectKey}/agent-optimizations."""
        headers = {
            "Content-Type": "application/json",
            "Authorization": self.api_key,
            "LD-API-Version": "beta",
        }

        payload = {
            "key": key,
            "aiConfigKey": ai_config_key,
            "maxAttempts": max_attempts,
            "judgeModel": judge_model,
        }
        if model_choices is not None:
            payload["modelChoices"] = model_choices
        if acceptance_statements is not None:
            payload["acceptanceStatements"] = acceptance_statements
        if judges is not None:
            payload["judges"] = judges
        if user_input_options is not None:
            payload["userInputOptions"] = user_input_options
        if ground_truth_responses is not None:
            payload["groundTruthResponses"] = ground_truth_responses
        if metric_key is not None:
            payload["metricKey"] = metric_key
        if token_limit is not None:
            payload["tokenLimit"] = token_limit
        if variable_choices is not None:
            payload["variableChoices"] = variable_choices
        if latency_optimization is not None:
            payload["latencyOptimization"] = latency_optimization
        if token_optimization is not None:
            payload["tokenOptimization"] = token_optimization
        if auto_commit is not None:
            payload["autoCommit"] = auto_commit

        response = self.getrequest(
            "POST",
            f"https://app.launchdarkly.com/api/v2/projects/{self.project_key}/agent-optimizations",
            json=payload,
            headers=headers,
        )

        if response.status_code in (200, 201):
            data = response.json()
            return data
        elif response.status_code == 409:
            print(f"  Agent optimization '{key}' already exists, skipping")
            return {"key": key}
        else:
            print(f"  Error creating agent optimization '{key}': {response.status_code} {response.text[:300]}")
            return None

    def post_agent_optimization_result(self, optimization_key, run_id, version, iteration, instructions, user_input, parameters=None):
        """Create a new result (iteration) for an agent optimization run."""
        headers = {
            "Content-Type": "application/json",
            "Authorization": self.api_key,
            "LD-API-Version": "beta",
        }

        payload = {
            "runId": run_id,
            "agentOptimizationVersion": version,
            "iteration": iteration,
            "instructions": instructions,
            "userInput": user_input,
        }
        if parameters is not None:
            payload["parameters"] = parameters

        response = self.getrequest(
            "POST",
            f"https://app.launchdarkly.com/api/v2/projects/{self.project_key}/agent-optimizations/{optimization_key}/results",
            json=payload,
            headers=headers,
        )

        if response.status_code in (200, 201):
            data = response.json()
            return data.get("id")
        else:
            print(f"Error creating optimization result (iter {iteration}): {response.status_code} {response.text[:300]}")
            return None

    def patch_agent_optimization_result(self, optimization_key, result_id,
                                         status=None, activity=None, completion_response=None,
                                         variation=None, scores=None, generation_tokens=None,
                                         evaluation_tokens=None, generation_latency=None,
                                         evaluation_latencies=None, created_variation_key=None):
        """Update an agent optimization result with scores, status, response, etc."""
        headers = {
            "Content-Type": "application/json",
            "Authorization": self.api_key,
            "LD-API-Version": "beta",
        }

        payload = {}
        if status is not None:
            payload["status"] = status
        if activity is not None:
            payload["activity"] = activity
        if completion_response is not None:
            payload["completionResponse"] = completion_response
        if variation is not None:
            payload["variation"] = variation
        if scores is not None:
            payload["scores"] = scores
        if generation_tokens is not None:
            payload["generationTokens"] = generation_tokens
        if evaluation_tokens is not None:
            payload["evaluationTokens"] = evaluation_tokens
        if generation_latency is not None:
            payload["generationLatency"] = generation_latency
        if evaluation_latencies is not None:
            payload["evaluationLatencies"] = evaluation_latencies
        if created_variation_key is not None:
            payload["createdVariationKey"] = created_variation_key

        response = self.getrequest(
            "PATCH",
            f"https://app.launchdarkly.com/api/v2/projects/{self.project_key}/agent-optimizations/{optimization_key}/results/{result_id}",
            json=payload,
            headers=headers,
        )

        if response.status_code in (200, 204):
            return True
        else:
            print(f"Error updating optimization result {result_id}: {response.status_code} {response.text[:300]}")
            return False

    ##################################################
    # Create Prompt Snippet (AI Config Library)
    ##################################################

    def create_snippet(self, key, name, text, description=None, tags=None):
        """Create a reusable prompt snippet in the AI Configs Library."""
        headers = {
            "Content-Type": "application/json",
            "Authorization": self.api_key,
        }

        payload = {
            "key": key,
            "name": name,
            "text": text,
        }
        if description:
            payload["description"] = description
        if tags:
            payload["tags"] = tags

        response = self.getrequest(
            "POST",
            f"https://app.launchdarkly.com/api/v2/projects/{self.project_key}/ai-configs/prompt-snippets",
            json=payload,
            headers=headers,
        )

        if response.status_code in (200, 201):
            data = json.loads(response.text)
            print(f"  Snippet created: {name}")
            return data
        elif response.status_code == 409:
            print(f"  Snippet '{key}' already exists, skipping")
            return {"key": key, "version": 1}
        else:
            print(f"  Error creating snippet '{key}': {response.status_code} {response.text[:300]}")
            return None